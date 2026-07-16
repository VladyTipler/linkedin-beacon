const UNIT_DAYS: Record<string, number> = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }

/**
 * Approx age (days) of a LinkedIn "Sent X ago" invitation label. LinkedIn buckets to
 * minutes/hours/days/weeks/months/years; we map to a day estimate to compare against a
 * threshold. Unrecognized text → 0 (safe: an unknown age never counts as stale).
 */
export function parseInviteAgeDays(sentText: string): number {
  const m = (sentText || '').match(/(\d+)\s+(minute|hour|day|week|month|year)s?\b/i)
  if (!m) return 0
  return parseInt(m[1], 10) * (UNIT_DAYS[m[2].toLowerCase()] ?? 0)
}

/** True if the invite is at least `maxAgeDays` old (default policy: 14 days ≈ 2 weeks). */
export function isStaleInvite(sentText: string, maxAgeDays: number): boolean {
  return parseInviteAgeDays(sentText) >= maxAgeDays
}
