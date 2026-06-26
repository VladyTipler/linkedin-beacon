import { describe, it, expect } from 'vitest'
import { auditProfile } from './auditProfile'
import type { ProfileSnapshot } from './contracts'

const full: ProfileSnapshot = {
  hasPhoto: true, hasBanner: true, headline: 'Frontend TechLead, 11y Vue/TS', about: 'x'.repeat(50),
  location: 'Chisinau', industry: 'Software', educationCount: 1, pastPositionCount: 2,
  skillCount: 7, recommendationCount: 3, hasCurrentPosition: true, hasFeatured: true, hasCustomUrl: true
}
const empty: ProfileSnapshot = {
  hasPhoto: false, hasBanner: false, headline: null, about: null, location: null, industry: null,
  educationCount: 0, pastPositionCount: 0, skillCount: 0, recommendationCount: 0,
  hasCurrentPosition: false, hasFeatured: false, hasCustomUrl: false
}

describe('auditProfile', () => {
  it('full profile = All-Star, 100% completeness', () => {
    const a = auditProfile(full)
    expect(a.isAllStar).toBe(true)
    expect(a.completeness).toBe(100)
    expect(a.officialDone).toBe(7)
    expect(a.officialTotal).toBe(7)
  })
  it('empty profile = 0% completeness, not All-Star', () => {
    const a = auditProfile(empty)
    expect(a.completeness).toBe(0)
    expect(a.isAllStar).toBe(false)
  })
  it('completeness counts ONLY the 7 official Tier-1 items', () => {
    // Tier-1 all done but Tier-2 missing → still 100% + All-Star.
    const a = auditProfile({ ...full, hasBanner: false, hasFeatured: false, recommendationCount: 0, hasCustomUrl: false })
    expect(a.completeness).toBe(100)
    expect(a.isAllStar).toBe(true)
  })
  it('skills need ≥5 to count (official threshold)', () => {
    expect(auditProfile({ ...full, skillCount: 4 }).items.find((i) => i.key === 'skills')!.done).toBe(false)
    expect(auditProfile({ ...full, skillCount: 5 }).items.find((i) => i.key === 'skills')!.done).toBe(true)
  })
  it('every item carries a tier, hint and editUrl', () => {
    for (const i of auditProfile(empty).items) {
      expect(['official', 'best-practice']).toContain(i.tier)
      expect(i.hint.length).toBeGreaterThan(0)
      expect(i.editUrl).toMatch(/^https:\/\/www\.linkedin\.com\//)
    }
  })
})
