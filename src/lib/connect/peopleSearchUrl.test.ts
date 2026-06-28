import { describe, it, expect } from 'vitest'
import { peopleSearchUrl } from './peopleSearchUrl'

describe('peopleSearchUrl', () => {
  it('builds the people-search URL with url-encoded keywords', () => {
    expect(peopleSearchUrl('frontend recruiter')).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter'
    )
  })

  it('trims surrounding whitespace', () => {
    expect(peopleSearchUrl('  recruiter  ')).toContain('keywords=recruiter')
  })

  // geoUrn is IGNORED even when regions are passed: verified live (2026-06-28) that ANY
  // geoUrn format (JSON array / single / comma) makes LinkedIn's people-search stop
  // returning connectable results (0 "Invite to connect" anchors — the page shows search
  // suggestions / company entities instead). Global `keywords=…` returns connectable
  // people, so regions are dropped from the URL until a working multi-region format is found.
  it('drops geoUrn even when regions are given (geo-filter breaks connectable results)', () => {
    expect(peopleSearchUrl('recruiter', ['103644278', '101174742'])).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=recruiter'
    )
  })

  it('omits geoUrn when no regions are given', () => {
    expect(peopleSearchUrl('recruiter')).not.toContain('geoUrn')
  })
})
