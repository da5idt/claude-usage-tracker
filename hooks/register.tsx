import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DayModelRow, Metric, Range, UsageDay, UsageDb } from '../types'

const PANE = 'usage-tracker'
const TITLE = 'Claude usage'
// The desktop app starts sessions with the login PATH, not a shell's, so
// Homebrew and python.org installs are named by path too; Windows has `py`.
const PYTHONS: string[][] = [
  ['python3'],
  ['/opt/homebrew/bin/python3'],
  ['/usr/local/bin/python3'],
  ['/usr/bin/python3'],
  ['py', '-3'],
  ['python'],
]

const METRICS: { id: Metric; label: string; color: string }[] = [
  { id: 'total', label: 'Total', color: '#d97757' },
  { id: 'output', label: 'Output', color: '#6a9f6a' },
  { id: 'input', label: 'Input', color: '#5b8dbd' },
  { id: 'cacheRead', label: 'Cache read', color: '#9a7fc2' },
  { id: 'cacheWrite', label: 'Cache write', color: '#c9a85c' },
]

const RANGES: { id: Range; label: string; days: number }[] = [
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: 'all', label: 'All', days: 0 },
]

const db = atom({ plugin: 'usage-tracker', key: 'db' } as const, null)
const range = atom({ plugin: 'usage-tracker', key: 'range' } as const, '30d')
const metric = atom({ plugin: 'usage-tracker', key: 'metric' } as const, 'total')
const status = atom({ plugin: 'usage-tracker', key: 'status' } as const, '')

const valueOf = (row: DayModelRow, pick: Metric): number =>
  pick === 'total'
    ? row[0] + row[1] + row[2] + row[3]
    : pick === 'input'
      ? row[0]
      : pick === 'output'
        ? row[1]
        : pick === 'cacheRead'
          ? row[2]
          : row[3]

const dayValue = (day: UsageDay | undefined, pick: Metric): number =>
  day === undefined
    ? 0
    : Object.values(day.models).reduce((sum, row) => sum + valueOf(row, pick), 0)

const fmt = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`
  return String(n)
}

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const timeOf = (iso: string): string => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const lastDays = (count: number, now: number): string[] => {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    keys.push(dayKey(d))
  }
  return keys
}

const daysInRange = (data: UsageDb, pick: Range, now: number): string[] => {
  const span = RANGES.find(r => r.id === pick)?.days ?? 30
  if (pick !== 'all') return lastDays(span, now)
  const first = Object.keys(data.days).sort()[0]
  if (first === undefined) return lastDays(7, now)
  const count = Math.floor((now - Date.parse(`${first}T00:00:00`)) / 86_400_000) + 1
  return lastDays(Math.max(7, Math.min(count, 365)), now)
}

// A model answered at most once per (message id, request id): scans only ever
// add to a day's totals, so when a transcript is cleaned up the stored maximum
// per cell keeps that day's history.
const merge = (kept: UsageDb | null, scanned: UsageDb): UsageDb => {
  const days: Record<string, UsageDay> = { ...(kept?.days ?? {}) }
  for (const [day, fresh] of Object.entries(scanned.days)) {
    const old = days[day]
    if (old === undefined) {
      days[day] = fresh
      continue
    }
    const models: Record<string, DayModelRow> = { ...old.models }
    for (const [model, row] of Object.entries(fresh.models)) {
      const prior = models[model]
      models[model] =
        prior === undefined
          ? row
          : (row.map((n, i) => Math.max(n, prior[i] ?? 0)) as DayModelRow)
    }
    days[day] = { models, sessions: Math.max(old.sessions, fresh.sessions) }
  }
  return { days, scannedAt: scanned.scannedAt }
}

let isScanning = false
let lastScanAt = 0

const rescan = async ($: EngineInterface, isForced = false): Promise<void> => {
  if (isScanning || (!isForced && Date.now() - lastScanAt < 90_000)) return
  isScanning = true
  try {
    await update($, status, () => 'Scanning transcripts…')
    const script = `${$.plugin.root}/scripts/aggregate.py`
    let out: string | undefined
    let fault = ''
    let hasStarted = false
    for (const python of PYTHONS) {
      try {
        const ran = await $.process.run([...python, script], { timeoutMs: 120_000 })
        if (ran.exitCode === 0 && !ran.isStdoutTruncated) {
          out = ran.stdout
          break
        }
        // A Python 2 `python`, or a Store or Xcode stub, runs but fails: keep
        // looking, and report the failure of the last one that ran.
        hasStarted = true
        fault = ran.stderr.slice(0, 160) || `exit ${ran.exitCode}`
      } catch {
        // Not installed there: try the next.
      }
    }
    if (out === undefined) {
      await update($, status, () =>
        hasStarted
          ? `Scan failed: ${fault}`
          : 'Scan failed: Python 3 not found. Install it from python.org, then press Refresh.',
      )
      return
    }
    const scanned = JSON.parse(out) as UsageDb
    const kept = ((await $.store.get('db')) ?? null) as UsageDb | null
    const merged = merge(kept, scanned)
    await $.store.set('db', merged)
    await update($, db, () => merged)
    lastScanAt = Date.now()
    await update($, status, () => '')
  } finally {
    isScanning = false
  }
}

const chartSvg = (labels: string[], values: number[], color: string): string => {
  const width = 640
  const height = 210
  const padLeft = 44
  const padRight = 6
  const padTop = 12
  const padBottom = 22
  const innerWidth = width - padLeft - padRight
  const innerHeight = height - padTop - padBottom
  const max = Math.max(...values, 1)
  const step = innerWidth / Math.max(values.length, 1)
  const barWidth = Math.max(1, Math.min(28, step * 0.7))
  const axis = '#8a8a8a'
  const parts: string[] = []
  for (const share of [0, 0.5, 1]) {
    const y = padTop + innerHeight * (1 - share)
    parts.push(
      `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="${axis}" stroke-opacity="0.35" stroke-width="1"/>`,
      `<text x="${padLeft - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${axis}">${fmt(Math.round(max * share))}</text>`,
    )
  }
  values.forEach((value, i) => {
    const barHeight = Math.max((value / max) * innerHeight, value > 0 ? 1.5 : 0)
    const x = padLeft + step * i + (step - barWidth) / 2
    const y = padTop + innerHeight - barHeight
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1.5" fill="${color}"><title>${labels[i]}: ${fmt(value)} tokens</title></rect>`,
    )
  })
  for (const i of new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])) {
    const x = padLeft + step * i + step / 2
    parts.push(
      `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="11" fill="${axis}">${(labels[i] ?? '').slice(5)}</text>`,
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${parts.join('')}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-tracker',
      description: 'Show your Claude usage over time in a pane',
    })
    void (async () => {
      const kept = ((await $.store.get('db')) ?? null) as UsageDb | null
      if (kept !== null) await update($, db, () => kept)
      if ((await $.store.get('hasOpenedOnce')) !== true) {
        await $.store.set('hasOpenedOnce', true)
        await $.ui.open({ id: PANE, title: TITLE })
      }
      await rescan($, true)
    })()

    return next(e)
  })

  on('command.run', { command: 'usage-tracker' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await rescan($, true)

    return { text: 'Claude usage pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void rescan($)

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const data = await read($, db)
    const picked = await read($, range)
    const measure = await read($, metric)
    const note = await read($, status)
    const now = await $.clock.now()

    if (data === null) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text dimColor>{note === '' ? 'No usage data yet.' : note}</Text>
        </Box>
      )
    }

    const keys = daysInRange(data, picked, now)
    const values = keys.map(key => dayValue(data.days[key], measure))
    const sumOver = (count: number): number =>
      lastDays(count, now).reduce((sum, key) => sum + dayValue(data.days[key], measure), 0)
    const totals: [string, number][] = [
      ['Today', dayValue(data.days[dayKey(new Date(now))], measure)],
      ['7 days', sumOver(7)],
      ['30 days', sumOver(30)],
      ['All time', Object.values(data.days).reduce((sum, day) => sum + dayValue(day, measure), 0)],
    ]

    const byModel = new Map<string, DayModelRow>()
    for (const key of keys) {
      const day = data.days[key]
      if (day === undefined) continue
      for (const [model, row] of Object.entries(day.models)) {
        const kept = byModel.get(model) ?? [0, 0, 0, 0, 0]
        byModel.set(model, kept.map((n, i) => n + (row[i] ?? 0)) as DayModelRow)
      }
    }
    const models = [...byModel.entries()]
      .sort((a, b) => valueOf(b[1], 'total') - valueOf(a[1], 'total'))
      .slice(0, 6)

    const color = METRICS.find(m => m.id === measure)?.color ?? '#d97757'
    const shown = keys.slice(-14)
    const peak = Math.max(...shown.map(key => dayValue(data.days[key], measure)), 1)
    const chart =
      e.surface === 'terminal' ? (
        <Box flexDirection="column">
          {shown.map(key => {
            const value = dayValue(data.days[key], measure)
            return (
              <Text>
                <Text dimColor>{key.slice(5)} </Text>
                {'█'.repeat(Math.round((value / peak) * 24))}
                <Text dimColor> {fmt(value)}</Text>
              </Text>
            )
          })}
        </Box>
      ) : (
        (() => {
          const { Svg } = $.ui.resolve(e)
          return (
            <Svg
              source={chartSvg(keys, values, color)}
              alt={`Daily ${measure} tokens, ${keys[0]} to ${keys[keys.length - 1]}`}
              isInteractive
            />
          )
        })()
      )

    return (
      <Box flexDirection="column" padding={1} gap={1}>
        <Box gap={3}>
          {totals.map(([label, value]) => (
            <Box key={label} flexDirection="column">
              <Text bold>{fmt(value)}</Text>
              <Text dimColor>{label}</Text>
            </Box>
          ))}
        </Box>
        <Box gap={1} flexWrap="wrap">
          {RANGES.map(r => (
            <Button
              key={`range-${r.id}`}
              label={r.label}
              variant={picked === r.id ? 'primary' : 'secondary'}
              onPress={() => update($, range, () => r.id)}
            />
          ))}
          <Text dimColor> </Text>
          {METRICS.map(m => (
            <Button
              key={`metric-${m.id}`}
              label={m.label}
              variant={measure === m.id ? 'primary' : 'secondary'}
              onPress={() => update($, metric, () => m.id)}
            />
          ))}
        </Box>
        {chart}
        <Box flexDirection="column">
          <Text dimColor>By model over the selected range</Text>
          {models.map(([model, row]) => (
            <Box key={model} gap={2}>
              <Box flexGrow={1}>
                <Text>{model}</Text>
              </Box>
              <Text dimColor>{fmt(row[4])} msgs</Text>
              <Text dimColor>out {fmt(row[1])}</Text>
              <Text>{fmt(valueOf(row, 'total'))}</Text>
            </Box>
          ))}
        </Box>
        <Box gap={1}>
          <Text dimColor>
            {note !== '' ? note : `Scanned ${timeOf(data.scannedAt)} · from local transcripts`}
          </Text>
          <Box flexGrow={1} />
          <Button key="refresh" label="Refresh" onPress={() => rescan($, true)} />
        </Box>
      </Box>
    )
  })
}
