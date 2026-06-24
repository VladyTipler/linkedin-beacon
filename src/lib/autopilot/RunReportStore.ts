import type { KeyValueStore } from '../ports'
import type { RunReport } from '../types'

export const REPORTS_KEY = 'autopilot:reports'

/** Persists autopilot run reports, newest first, capped. */
export class RunReportStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly cap = 50
  ) {}

  async add(report: RunReport): Promise<void> {
    const next = [report, ...(await this.list())].slice(0, this.cap)
    await this.store.set(REPORTS_KEY, next)
  }

  async list(): Promise<RunReport[]> {
    const stored = await this.store.get<RunReport[]>(REPORTS_KEY)
    return Array.isArray(stored) ? stored : []
  }
}
