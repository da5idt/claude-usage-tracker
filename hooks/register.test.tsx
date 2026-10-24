import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'usage-tracker',
  component: 'Pane',
  requestId: 'usage-tracker',
  props: {
    title: 'Claude usage',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const RUN = {
  command: 'usage-tracker',
  args: '',
  origin: { kind: 'plugin', name: 'test' },
  presentation: { isFullscreen: false, columns: 80 },
} as const

test('the pane shows totals aggregated from a scan', async ($, on) => {
  const scan = {
    days: {
      [dayKey(new Date())]: {
        models: { 'claude-fable-5': [100, 2000, 50000, 10000, 4] },
        sessions: 1,
      },
    },
    files: 1,
    scannedAt: new Date().toISOString(),
  }

  mock.store(on)
  mock.clock(on, { now: Date.now() })
  on('command.register', () => ({ value: { command: 'usage-tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(scan),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // 100 + 2000 + 50000 + 10000 = 62100 total tokens today and all time,
  // drawn as 62k (one decimal only below 10k).
  const today = await ui.find({ type: 'Text', text: /^62k$/ })
  expect(today).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /claude-fable-5/ })).toBeDefined()
  await ui.unmount()
})

test('the output metric charts output tokens alone', async ($, on) => {
  const scan = {
    days: {
      [dayKey(new Date())]: {
        models: { 'claude-fable-5': [100, 2000, 50000, 10000, 4] },
        sessions: 1,
      },
    },
    files: 1,
    scannedAt: new Date().toISOString(),
  }

  mock.store(on)
  mock.clock(on, { now: Date.now() })
  on('command.register', () => ({ value: { command: 'usage-tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(scan),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'metric-output' })
  expect(await ui.find({ type: 'Text', text: /^2\.0k$/ })).toBeDefined()
  await ui.unmount()
})
