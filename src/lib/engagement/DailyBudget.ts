/** Persisted budget counter for one UTC day. */
export interface DailyBudgetState {
  /** UTC day key, YYYY-MM-DD. */
  day: string
  /** Actions spent on that day. */
  used: number
}

/**
 * A per-day action budget (design-spec §5: daily.engage / daily.comments).
 * Pure: state is passed in and a new state returned, so persistence lives in the
 * caller (chrome.storage). Reusable for likes, comments, or any daily-capped
 * action. Day boundary is UTC for now; user-TZ work-hours are a Phase 3 concern.
 */
export class DailyBudget {
  constructor(private readonly limit: number) {}

  canSpend(state: DailyBudgetState | null, now: Date): boolean {
    return this.remaining(state, now) > 0
  }

  remaining(state: DailyBudgetState | null, now: Date): number {
    const used = this.usedToday(state, now)
    return Math.max(0, this.limit - used)
  }

  /** Returns the next state after spending one unit (handles day rollover). */
  spend(state: DailyBudgetState | null, now: Date): DailyBudgetState {
    return { day: dayKey(now), used: this.usedToday(state, now) + 1 }
  }

  private usedToday(state: DailyBudgetState | null, now: Date): number {
    if (!state || state.day !== dayKey(now)) return 0
    return state.used
  }
}

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}
