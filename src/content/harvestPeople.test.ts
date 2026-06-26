// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { harvestPeople, harvestUntilReady } from './harvestPeople'
import { PEOPLE_SEARCH_HTML } from './__fixtures__/people-search-card'
import type { PersonCandidate } from '@lib/types'

describe('harvestPeople (real card HTML boundary)', () => {
  beforeEach(() => { document.body.innerHTML = PEOPLE_SEARCH_HTML })

  it('parses connectable cards with memberId, name, headline, profileUrl', () => {
    const people = harvestPeople(document)
    expect(people).toEqual([
      { memberId: '1094785181', name: 'Olena Diachenko', headline: 'Frontend Developer | JavaScript | React | TypeScript', profileUrl: 'https://www.linkedin.com/in/olena-diachenko-2a5784266/' },
      { memberId: '579929146', name: 'Predrag Vasic', headline: 'Talent Acquisition Specialist | Technical Recruiter | IT Recruiter', profileUrl: 'https://www.linkedin.com/in/predrag-vasic-18a273142/' }
    ])
  })

  it('excludes Follow-only people (no Connect anchor)', () => {
    expect(harvestPeople(document).some((p) => p.name === 'Shubh Yadav')).toBe(false)
  })
})

describe('harvestUntilReady (poll until LinkedIn renders search results)', () => {
  const cand: PersonCandidate = { memberId: '1', name: 'A', headline: '', profileUrl: '' }

  it('retries until results render, then returns them', async () => {
    let calls = 0
    const harvest = () => (++calls >= 3 ? [cand] : []) // empty twice, then rendered
    const sleeps: number[] = []
    const res = await harvestUntilReady(harvest, async (ms) => { sleeps.push(ms) }, 16, 500)
    expect(res).toEqual([cand])
    expect(calls).toBe(3)
    expect(sleeps).toEqual([500, 500]) // slept twice before success
  })

  it('gives up after the attempts and returns the last (possibly empty) result', async () => {
    let calls = 0
    const res = await harvestUntilReady(() => { calls++; return [] }, async () => {}, 3, 10)
    expect(res).toEqual([])
    expect(calls).toBe(4) // 3 in-loop attempts + 1 final
  })
})
