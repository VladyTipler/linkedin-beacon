import type { ProfileViewsSnapshot } from '../types'

/** Snapshot shape before the capturedAt timestamp is stamped. */
export type RawProfileViews = Omit<ProfileViewsSnapshot, 'capturedAt'>

const LABEL = /profile viewers in the past (\d+) days/i
// The text inside each SDUI `"children":["…"]` node (single-string children only).
const CHILDREN_TOKEN = /"children":\["((?:[^"\\]|\\.)*)"\]/g
const PURE_NUMBER = /^\d[\d,]*$/

/** Tokens from an SDUI RSC flight payload: the string inside each `"children":["…"]`. */
function tokenizeRsc(text: string): string[] {
  return [...text.matchAll(CHILDREN_TOKEN)].map((m) => m[1])
}

/**
 * From the ordered token list, find the WVMP label ("Profile viewers in the past
 * N days") and take the NEAREST PRECEDING pure-number token as the count. This
 * ignores distractor numbers elsewhere on the page (notification badges, "4
 * recruiters", CSS values). Returns null if the anchor is absent — the caller
 * then leaves the metric unknown rather than inventing a zero. Pure.
 */
function extractFromTokens(tokens: string[]): RawProfileViews | null {
  const labelIdx = tokens.findIndex((t) => LABEL.test(t))
  if (labelIdx < 0) return null
  const windowDays = Number(tokens[labelIdx].match(LABEL)![1])
  for (let i = labelIdx - 1; i >= 0; i--) {
    if (PURE_NUMBER.test(tokens[i])) {
      const count = Number(tokens[i].replace(/,/g, ''))
      if (Number.isFinite(count)) return { count, windowDays }
    }
  }
  return null
}

/**
 * Parse the WVMP count from the SDUI server-request (`sduiid=WvmpAnalytics`) RSC
 * response — the metric's only source (LinkedIn exposes no clean JSON endpoint for
 * it; the number lives in the RSC flight payload next to its label).
 */
export function parseWvmpRsc(text: string): RawProfileViews | null {
  return extractFromTokens(tokenizeRsc(text))
}
