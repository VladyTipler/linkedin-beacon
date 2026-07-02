import { describe, it, expect } from 'vitest'
import { parseWvmpRsc, parseWvmpDom } from './wvmpParser'
import { WVMP_RSC_FIXTURE, WVMP_DOM_FIXTURE } from './fixtures/wvmpFixtures'

// Real, PII-sanitized dumps captured live from Vlad's authorized session
// (2026-07-02). These CROSS the LinkedIn boundary: the parser runs against the
// actual response/DOM shape, not a hand-mocked one.

describe('parseWvmpRsc — SDUI WvmpAnalytics response (real dump)', () => {
  it('extracts the rolling count + window from the real RSC payload', () => {
    expect(parseWvmpRsc(WVMP_RSC_FIXTURE)).toEqual({ count: 45, windowDays: 90 })
  })

  it('returns null when the WVMP anchor is absent (no invented zero)', () => {
    expect(parseWvmpRsc('{"children":["Some other card"]}')).toBeNull()
  })
})

describe('parseWvmpDom — rendered analytics innerText (real dump)', () => {
  it('extracts count + window, ignoring distractor numbers on the page', () => {
    // fixture includes a "3" notifications badge above the real "45" number
    expect(parseWvmpDom(WVMP_DOM_FIXTURE)).toEqual({ count: 45, windowDays: 90 })
  })

  it('returns null when the anchor is absent', () => {
    expect(parseWvmpDom('Home\nMy Network\n3\nNotifications')).toBeNull()
  })

  it('strips thousands separators and honours a different window', () => {
    expect(parseWvmpDom('Who viewed you\n1,234\nProfile viewers in the past 30 days')).toEqual({
      count: 1234,
      windowDays: 30
    })
  })
})
