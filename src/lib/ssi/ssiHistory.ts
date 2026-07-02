import type { SsiSnapshot } from '../types'

/**
 * UTC calendar-day bucket (YYYY-MM-DD) for a snapshot's capturedAt.
 * Invalid dates key by their raw string so corrupt/non-date values stay unique
 * rather than collapsing into one bucket.
 */
export function dayKey(capturedAt: string): string {
  const t = Date.parse(capturedAt)
  return Number.isNaN(t) ? capturedAt : new Date(t).toISOString().slice(0, 10)
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/**
 * Fold a fresh snapshot into day-bucketed history: exactly one entry per calendar
 * day (UTC), where the latest capture wins for that day. Result is sorted
 * oldest→newest and capped to the last `capDays` days.
 *
 * Pure. Tolerates a corrupt / non-array stored value (storage gotcha), so a
 * garbled `ssi:history` can never crash a save.
 */
export function upsertDailySnapshot(
  existing: unknown,
  snapshot: SsiSnapshot,
  capDays = 90
): SsiSnapshot[] {
  const byDay = new Map<string, SsiSnapshot>()
  for (const s of asArray<SsiSnapshot>(existing)) byDay.set(dayKey(s.capturedAt), s)
  byDay.set(dayKey(snapshot.capturedAt), snapshot) // newest capture wins the day
  const sorted = [...byDay.values()].sort(
    (a, b) => (Date.parse(a.capturedAt) || 0) - (Date.parse(b.capturedAt) || 0)
  )
  return capDays > 0 ? sorted.slice(-capDays) : sorted
}
