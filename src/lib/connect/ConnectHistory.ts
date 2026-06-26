import { asArray } from '../engagement/settings'

export const CONNECT_HISTORY_KEY = 'connect:history'

/** One sent connection request, with enough detail to show WHO was added and when. */
export interface ConnectRecord {
  memberId: string
  name: string
  headline: string
  profileUrl: string
  /** ISO timestamp the invite was sent. */
  sentAt: string
}

/**
 * Newest-first connect history, capped to the most recent `cap`. Tolerates a non-array
 * stored value (chrome.storage array-as-object gotcha) via asArray. Pure.
 */
export function appendConnectHistory(
  existing: unknown,
  records: ConnectRecord[],
  cap = 500
): ConnectRecord[] {
  return [...records, ...asArray<ConnectRecord>(existing)].slice(0, cap)
}
