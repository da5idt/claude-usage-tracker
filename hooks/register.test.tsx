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

test('a desktop session without python3 on its PATH scans with py -3, on every surface', async ($, on) => {
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
  const tried: string[] = []

  mock.store(on)
  mock.clock(on, { now: Date.now() })
  on('command.register', () => ({ value: { command: 'usage-tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    tried.push(e.argv.slice(0, -1).join(' '))
    if (e.argv[0] !== 'py') return { deny: `spawn ${e.argv[0]} ENOENT` }
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(scan),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)
  expect(tried).toContain('py -3')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^62k$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane says so when no Python 3 is installed', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.now() })
  on('command.register', () => ({ value: { command: 'usage-tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    return { deny: `spawn ${e.argv[0]} ENOENT` }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Python 3 not found/ })).toBeDefined()
  await ui.unmount()
})

test('an interpreter that runs but fails is passed over, and a script error is shown', async ($, on) => {
  const tried: string[] = []

  mock.store(on)
  mock.clock(on, { now: Date.now() })
  on('command.register', () => ({ value: { command: 'usage-tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    tried.push(e.argv[0] ?? '')
    const result = { stdout: '', isStdoutTruncated: false, isStderrTruncated: false }
    // python3 on the PATH is an Xcode stub; Homebrew's Python hits a bad transcript.
    if (e.argv[0] === 'python3') {
      return { value: { ...result, exitCode: 1, stderr: 'xcode-select: note: No developer tools were found' } }
    }
    if (e.argv[0] === '/opt/homebrew/bin/python3') {
      return {
        value: {
          ...result,
          exitCode: 1,
          stderr: 'Traceback (most recent call last):\n  File "aggregate.py"\nMemoryError: out of memory',
        },
      }
    }
    return { deny: `spawn ${e.argv[0]} ENOENT` }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)
  expect(tried).toEqual(['python3', '/opt/homebrew/bin/python3'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Scan failed: MemoryError: out of memory$/ })).toBeDefined()
  await ui.unmount()
})

test('a Windows Store alias counts as no Python', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.now() })
  on('command.register', () => ({ value: { command: 'usage-tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'python3' || e.argv[0] === 'python') {
      return {
        value: {
          exitCode: 9009,
          stdout: '',
          stderr: 'Python was not found; run without arguments to install from the Microsoft Store',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    return { deny: `spawn ${e.argv[0]} ENOENT` }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run(RUN)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Python 3 not found/ })).toBeDefined()
  await ui.unmount()
})
