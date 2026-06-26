import type { ModuleState } from '../types'
import type { Rng } from '../ports'
import { asArray } from '../engagement/settings'
export { isoWeekKey } from '../content/PostWeekBudget'

export const CONNECT_WEEK_BUDGET_KEY = 'connects:budget'
export const DEFAULT_CONNECTS_PER_WEEK = 100

/** Persisted week-keyed connects/week counter (ISO-week, mirrors PostWeek). */
export interface ConnectWeek {
  week: string
  used: number
}

export function rolloverConnectWeek(prev: ConnectWeek | null, weekKey: string): ConnectWeek {
  if (prev && prev.week === weekKey) return prev
  return { week: weekKey, used: 0 }
}

export function recordConnectWeek(state: ConnectWeek, n: number): ConnectWeek {
  return { week: state.week, used: state.used + Math.max(0, n) }
}

export function remainingConnects(state: ConnectWeek, limit: number): number {
  return Math.max(0, limit - state.used)
}

/** The weekly connect cap = the smart_connect module's limit input (default 100). */
export function connectsPerWeek(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'smart_connect')
  return typeof m?.dailyLimit === 'number' && m.dailyLimit > 0 ? m.dailyLimit : DEFAULT_CONNECTS_PER_WEEK
}

/**
 * How many to attempt THIS run. Firing the whole weekly budget in one walk-away run
 * = instant restriction, so cap at a daily share with DOWNWARD-only jitter, bounded by
 * the weekly remaining. Pure (jitter via the Rng port).
 */
export function connectRunCap(weeklyRemaining: number, perWeek: number, rng: Rng): number {
  const dailyShare = Math.max(1, Math.round(perWeek / 7))
  const maxDown = Math.ceil(dailyShare * 0.4)
  const jittered = dailyShare - Math.floor((1 - rng.next()) * (maxDown + 1)) // [dailyShare-(maxDown+1), dailyShare]
  return Math.max(0, Math.min(weeklyRemaining, jittered))
}
