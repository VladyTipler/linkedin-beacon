import { asArray } from '../engagement/settings'

export const VIEW_HISTORY_KEY = 'views:history'

/** One viewed profile, with enough detail to show WHO was visited and when. */
export interface ViewRecord {
  memberId: string
  name: string
  headline: string
  profileUrl: string
  /** ISO timestamp the profile was visited. */
  viewedAt: string
}

/** Newest-first view history, capped. Tolerates a non-array stored value (storage gotcha). Pure. */
export function appendViewHistory(existing: unknown, records: ViewRecord[], cap = 500): ViewRecord[] {
  return [...records, ...asArray<ViewRecord>(existing)].slice(0, cap)
}
