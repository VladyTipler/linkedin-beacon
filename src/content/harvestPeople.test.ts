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
const ok = (candidates: PersonCandidate[]) => ({ candidates, outcome: 'ok' as const })

describe('harvestPeoplePage (wait for the page to render before reading)', () => {
  const never = () => false // empty-state never appears

  it('polls until cards render, then returns them with outcome ok', async () => {
    let calls = 0
    const res = await harvestPeoplePage(() => (++calls >= 3 ? [c('1')] : []), async () => {}, never, 16, 500)
    expect(res).toEqual({ candidates: [c('1')], outcome: 'ok' })
    expect(calls).toBe(3)
  })

  it('exits early as empty the moment the "No results found" state renders', async () => {
    let calls = 0
    let empty = false
    const res = await harvestPeoplePage(
      () => { calls++; return [] },
      async () => { empty = true }, // empty-state appears after the first wait
      () => empty,
      16,
      10
    )
    expect(res).toEqual({ candidates: [], outcome: 'empty' })
    // stopped as soon as empty-state showed — did NOT burn all 16 attempts
    expect(calls).toBeLessThan(5)
  })

  it('reports not_ready when neither cards nor empty-state appear in time', async () => {
    let calls = 0
    const res = await harvestPeoplePage(() => { calls++; return [] }, async () => {}, never, 3, 10)
    expect(res).toEqual({ candidates: [], outcome: 'not_ready' })
    expect(calls).toBe(4) // 3 in-loop + 1 final
  })
})

describe('harvestPeoplePaginated (accumulate across pagination)', () => {
  it('harvests each page, dedups by memberId, advances until there is no next page', async () => {
    const pages = [ok([c('1'), c('2')]), ok([c('2'), c('3')]), ok([c('4')])]
    let p = 0
    const res = await harvestPeoplePaginated(
      async () => pages[p],
      async () => { p++; return p < pages.length },
      { target: 30, maxPages: 5 }
    )
    expect(res.candidates.map((x) => x.memberId).sort()).toEqual(['1', '2', '3', '4'])
    expect(res.outcome).toBe('ok')
  })

  it('stops at the target without paginating further', async () => {
    let nexts = 0
    const res = await harvestPeoplePaginated(
      async () => ok([c('1'), c('2'), c('3')]),
      async () => { nexts++; return true },
      { target: 3, maxPages: 5 }
    )
    expect(res.candidates).toHaveLength(3)
    expect(nexts).toBe(0)
  })

  it('propagates a non-ok first page WITHOUT paginating (empty search = stop)', async () => {
    let nexts = 0
    const res = await harvestPeoplePaginated(
      async () => ({ candidates: [], outcome: 'empty' as const }),
      async () => { nexts++; return true },
      { target: 30, maxPages: 5 }
    )
    expect(res).toEqual({ candidates: [], outcome: 'empty' })
    expect(nexts).toBe(0)
  })

  it('propagates not_ready from the first page', async () => {
    const res = await harvestPeoplePaginated(
      async () => ({ candidates: [], outcome: 'not_ready' as const }),
      async () => true,
      { target: 30, maxPages: 3 }
    )
    expect(res.outcome).toBe('not_ready')
  })
})
