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
})
