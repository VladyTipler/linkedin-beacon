// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { harvestPeople, harvestPeoplePage, harvestPeoplePaginated } from './harvestPeople'
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

const c = (id: string): PersonCandidate => ({ memberId: id, name: id, headline: '', profileUrl: '' })

describe('harvestPeoplePage (wait for the page to render before reading)', () => {
  it('polls until cards render, then returns them', async () => {
    let calls = 0
    const res = await harvestPeoplePage(() => (++calls >= 3 ? [c('1')] : []), async () => {}, 16, 500)
    expect(res).toEqual([c('1')])
    expect(calls).toBe(3)
  })

  it('returns [] if nothing renders within the attempts', async () => {
    let calls = 0
    const res = await harvestPeoplePage(() => { calls++; return [] }, async () => {}, 3, 10)
    expect(res).toEqual([])
    expect(calls).toBe(4) // 3 in-loop + 1 final
  })
})

describe('harvestPeoplePaginated (accumulate across pagination)', () => {
  it('harvests each page, dedups by memberId, advances until there is no next page', async () => {
    const pages = [[c('1'), c('2')], [c('2'), c('3')], [c('4')]]
    let p = 0
    const res = await harvestPeoplePaginated(
      async () => pages[p],
      async () => { p++; return p < pages.length },
      { target: 30, maxPages: 5 }
    )
    expect(res.map((x) => x.memberId).sort()).toEqual(['1', '2', '3', '4'])
  })

  it('stops at the target without paginating further', async () => {
    let nexts = 0
    const res = await harvestPeoplePaginated(
      async () => [c('1'), c('2'), c('3')],
      async () => { nexts++; return true },
      { target: 3, maxPages: 5 }
    )
    expect(res).toHaveLength(3)
    expect(nexts).toBe(0)
  })

  it('is bounded by maxPages', async () => {
    let reads = 0
    const res = await harvestPeoplePaginated(
      async () => { reads++; return [] },
      async () => true,
      { target: 30, maxPages: 3 }
    )
    expect(res).toEqual([])
    expect(reads).toBe(3)
  })
})
