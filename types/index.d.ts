/** One model's tokens for one day: [input, output, cacheRead, cacheWrite, messages]. */
export type DayModelRow = [number, number, number, number, number]

export type UsageDay = {
  models: Record<string, DayModelRow>
  sessions: number
}

export type UsageDb = {
  days: Record<string, UsageDay>
  scannedAt: string
}

export type Range = '7d' | '30d' | '90d' | 'all'

export type Metric = 'total' | 'output' | 'input' | 'cacheRead' | 'cacheWrite'

declare module 'claude-code' {
  interface PluginState {
    'usage-tracker': {
      db: UsageDb | null
      range: Range
      metric: Metric
      status: string
    }
  }
}
