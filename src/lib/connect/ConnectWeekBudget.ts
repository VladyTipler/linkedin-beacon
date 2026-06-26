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

export const CONNECT_DAY_BUDGET_KEY = 'connects:daily'

/** Persisted day-keyed connects/day counter (YYYY-MM-DD) — the daily anti-ban ceiling. */
export interface ConnectDay {
  day: string
  used: number
}

export function rolloverConnectDay(prev: ConnectDay | null, dayKey: string): ConnectDay {
  if (prev && prev.day === dayKey) return prev
  return { day: dayKey, used: 0 }
}

export function recordConnectDay(state: ConnectDay, n: number): ConnectDay {
  return { day: state.day, used: state.used + Math.max(0, n) }
}

/** Daily ceiling derived from the weekly cap (≈ perWeek/7) — no separate user knob (ONE-BUTTON). */
export function dailyConnectCap(perWeek: number): number {
  return Math.max(1, Math.round(perWeek / 7))
}

export function remainingDailyConnects(state: ConnectDay, dailyCap: number): number {
  return Math.max(0, dailyCap - state.used)
}

/** The weekly connect cap = the smart_connect module's limit input (default 100). */
export function connectsPerWeek(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'smart_connect')
  return typeof m?.dailyLimit === 'number' && m.dailyLimit > 0 ? m.dailyLimit : DEFAULT_CONNECTS_PER_WEEK
}

/**
 * How many to attempt THIS run. Firing the whole weekly budget in one walk-away run
 * = instant restriction, so cap at a daily share with DOWNWARD-only jitter, bounded by
 * BOTH the weekly remaining AND the day's remaining allowance — so many runs in one day
 * (even with changed keywords) can't front-load the week. Pure (jitter via the Rng port).
 */
export function connectRunCap(
  weeklyRemaining: number,
  dailyRemaining: number,
  perWeek: number,
  rng: Rng
): number {
  const dailyShare = dailyConnectCap(perWeek)
  const maxDown = Math.ceil(dailyShare * 0.4)
  const jittered = dailyShare - Math.floor((1 - rng.next()) * (maxDown + 1)) // [dailyShare-(maxDown+1), dailyShare]
  return Math.max(0, Math.min(weeklyRemaining, dailyRemaining, jittered))
}
