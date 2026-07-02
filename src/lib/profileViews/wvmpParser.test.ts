import { describe, it, expect } from 'vitest'
import { parseWvmpRsc } from './wvmpParser'
import { WVMP_RSC_FIXTURE } from './fixtures/wvmpFixtures'

// Real, PII-sanitized dump captured live from Vlad's authorized session
// (2026-07-02). This CROSSES the LinkedIn boundary: the parser runs against the
// actual SDUI response shape, not a hand-mocked one.

describe('parseWvmpRsc — SDUI WvmpAnalytics response (real dump)', () => {
  it('extracts the rolling count + window from the real RSC payload', () => {
    expect(parseWvmpRsc(WVMP_RSC_FIXTURE)).toEqual({ count: 45, windowDays: 90 })
  })

  it('ignores distractor numbers, taking the count nearest the anchor', () => {
    // a stray "179" (SDUI colour token) before the real "45" must not win
    const t = '"children":["179"] "children":["45"] "children":["Profile viewers in the past 90 days"]'
    expect(parseWvmpRsc(t)).toEqual({ count: 45, windowDays: 90 })
  })

  it('strips thousands separators and honours a different window', () => {
    const t = '"children":["1,234"] "children":["Profile viewers in the past 30 days"]'
    expect(parseWvmpRsc(t)).toEqual({ count: 1234, windowDays: 30 })
  })

  it('returns null when the WVMP anchor is absent (no invented zero)', () => {
    expect(parseWvmpRsc('{"children":["Some other card"]}')).toBeNull()
  })
})
