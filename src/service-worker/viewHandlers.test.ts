import { describe, it, expect } from 'vitest'
import { runViewStep } from './viewHandlers'
import { VIEW_DAY_BUDGET_KEY, VIEW_SEEN_KEY } from '../lib/views/ViewDayBudget'
import { VIEW_HISTORY_KEY } from '../lib/views/ViewHistory'
import type { PersonCandidate } from '../lib/types'

function fakeStore(initial: Record<string, unknown> = {}) {
  const data = { ...initial }
  return {
    data,
    get: async <T>(k: string) => (k in data ? (data[k] as T) : null),
    set: async <T>(k: string, v: T) => { data[k] = v }
  }
}
const clock = { now: () => new Date('2026-06-26T10:00:00Z') }
const rng = { next: () => 1 } // no down-jitter
const people: PersonCandidate[] = [
  { memberId: 'a', name: 'A', headline: 'Recruiter', profileUrl: 'https://l/in/a' },
  { memberId: 'b', name: 'B', headline: 'Eng', profileUrl: 'https://l/in/b' }
]

const baseDeps = (store: ReturnType<typeof fakeStore>) => ({
  store, clock, rng,
  searchUrl: 'https://l/search/people',
  navigate: async () => true,
  harvest: async () => ({ candidates: people, outcome: 'ok' as const }),
  dwell: async () => ({ ok: true }),
  pace: async () => {},
  cancelled: async () => false
})

describe('runViewStep', () => {
  it('skips when profile_views disabled', async () => {
    const store = fakeStore({ 'modules:state': [{ id: 'profile_views', enabled: false, dailyLimit: 40 }] })
    const res = await runViewStep(baseDeps(store))
    expect(res).toEqual({ executed: 0, skipped: 0, reason: 'disabled' })
  })

  it('views up to the daily cap, records history + day budget + seen-set', async () => {
    const store = fakeStore({ 'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 40 }] })
    const res = await runViewStep(baseDeps(store))
    expect(res.executed).toBe(2)
    expect(res.reason).toBe('done')
    expect((store.data[VIEW_HISTORY_KEY] as unknown[]).length).toBe(2)
    expect(store.data[VIEW_DAY_BUDGET_KEY]).toMatchObject({ day: '2026-06-26', used: 2 })
    expect(store.data[VIEW_SEEN_KEY]).toEqual(['a', 'b'])
  })

  it('dedups already-seen profiles', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 40 }],
      [VIEW_SEEN_KEY]: ['a']
    })
    const res = await runViewStep(baseDeps(store))
    expect(res.executed).toBe(1) // only 'b' is fresh
  })

  it('honors a near-exhausted daily budget', async () => {
    const store = fakeStore({
      'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 40 }],
      [VIEW_DAY_BUDGET_KEY]: { day: '2026-06-26', used: 39 }
    })
    const res = await runViewStep(baseDeps(store))
    expect(res.executed).toBe(1) // only 1 left today
  })

  it('persists NOTHING when every dwell fails (persist-only-on-success)', async () => {
    const store = fakeStore({ 'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 40 }] })
    const res = await runViewStep({ ...baseDeps(store), dwell: async () => ({ ok: false }) })
    expect(res).toMatchObject({ executed: 0, skipped: 2 })
    expect(store.data[VIEW_HISTORY_KEY]).toBeUndefined()
    expect(store.data[VIEW_DAY_BUDGET_KEY]).toBeUndefined()
    expect(store.data[VIEW_SEEN_KEY]).toBeUndefined()
  })

  const enabled = { 'modules:state': [{ id: 'profile_views', enabled: true, dailyLimit: 40 }] }

  it('reports nav_failed when the search page never confirmed loaded', async () => {
    const store = fakeStore(enabled)
    const res = await runViewStep({ ...baseDeps(store), navigate: async () => false })
    expect(res).toMatchObject({ executed: 0, reason: 'nav_failed' })
  })

  it('reports empty_search when the people-search rendered zero results', async () => {
    const store = fakeStore(enabled)
    const res = await runViewStep({ ...baseDeps(store), harvest: async () => ({ candidates: [], outcome: 'empty' as const }) })
    expect(res).toMatchObject({ executed: 0, reason: 'empty_search' })
  })

  it('reports not_ready when the search page never rendered its cards', async () => {
    const store = fakeStore(enabled)
    const res = await runViewStep({ ...baseDeps(store), harvest: async () => ({ candidates: [], outcome: 'not_ready' as const }) })
    expect(res).toMatchObject({ executed: 0, reason: 'not_ready' })
  })

  it('reports none_fresh when everyone harvested was already seen', async () => {
    const store = fakeStore({ ...enabled, [VIEW_SEEN_KEY]: ['a', 'b'] })
    const res = await runViewStep(baseDeps(store))
    expect(res).toMatchObject({ executed: 0, reason: 'none_fresh' })
  })

  it('STOPS mid-loop when the run is cancelled (views one profile, then aborts)', async () => {
    const store = fakeStore(enabled)
    let dwells = 0
    const res = await runViewStep({
      ...baseDeps(store),
      dwell: async () => { dwells++; return { ok: true } },
      cancelled: async () => dwells >= 1 // stop after the first view
    })
    expect(res.executed).toBe(1) // viewed 'a', then aborted — did NOT view 'b'
    expect(res.reason).toBe('cancelled')
  })
})
