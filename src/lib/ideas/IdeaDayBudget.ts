import type { ModuleState } from '../types'
import { asArray } from '../engagement/settings'

/** Persisted day-keyed ideas/day counter (mirrors the autopilot daily budget). */
export interface IdeaDay {
  day: string
  used: number
}

export const IDEA_BUDGET_KEY = 'ideas:budget'
export const DEFAULT_IDEAS_PER_DAY = 5

/** The content module's ideas/day limit (its dailyLimit); guards the array-as-object shape. */
export function ideasPerDayLimit(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'content')
  const n = m?.dailyLimit
  return typeof n === 'number' && n > 0 ? n : DEFAULT_IDEAS_PER_DAY
}

/** Same-day carry-over (don't re-grant); a new day resets used to 0. Pure. */
export function rolloverIdeaDay(prev: IdeaDay | null, today: string): IdeaDay {
  if (prev && prev.day === today) return prev
  return { day: today, used: 0 }
}

export function recordIdeaDay(state: IdeaDay, n: number): IdeaDay {
  return { day: state.day, used: state.used + Math.max(0, n) }
}

export function remainingIdeas(state: IdeaDay, limit: number): number {
  return Math.max(0, limit - state.used)
}
