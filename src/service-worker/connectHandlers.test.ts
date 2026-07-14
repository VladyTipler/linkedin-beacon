import { describe, it, expect, vi } from 'vitest'
import { runConnectStep, runConnectWithFallback } from './connectHandlers'
import { CONNECT_WEEK_BUDGET_KEY, CONNECT_DAY_BUDGET_KEY } from '@lib/connect/ConnectWeekBudget'
import { CONNECT_HISTORY_KEY, type ConnectRecord } from '@lib/connect/ConnectHistory'
import { CONNECT_SENT_KEY } from './connectHandlers'
import type { PersonCandidate } from '@lib/types'

const cand = (id: string): PersonCandidate => ({ memberId: id, name: id, headline: 'Recruiter', profileUrl: `/in/${id}` })

function deps(over: Partial<Record<string, unknown>> = {}) {
  const m = new Map<string, unknown>()
  m.set('modules:state', [{ id: 'smart_connect', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 100 }])
  m.set('connect:settings', { searchKeywords: 'frontend recruiter' })
  return {
    store: { get: async <T>(k: string) => (m.get(k) as T) ?? null, set: async (k: string, v: unknown) => void m.set(k, v) },
    clock: { now: () => new Date('2026-06-26T00:00:00Z') },
    rng: { next: () => 1 }, // no downward jitter → dailyShare = 14
    navigate: vi.fn(async () => true),
    harvest: vi.fn(async () => ({ candidates: [cand('1'), cand('2')], outcome: 'ok' as const })),
    nextPage: vi.fn(async () => false),
    connect: vi.fn(async () => ({ ok: true })),
    pace: vi.fn(async () => {}),
    cancelled: vi.fn(async () => false),
    _m: m,
    ...over
  }
}

describe('runConnectStep', () => {
  it('navigates, harvests, connects fresh candidates, records week + sent-set', async () => {
    const d = deps()
    const res = await runConnectStep(d)
    // default region US → geoUrn appended (settings has no targetRegions → defaults to ['US'])
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter&geoUrn=%5B%22103644278%22%5D&origin=FACETED_SEARCH')
    expect(d.connect).toHaveBeenCalledTimes(2)
    expect(res.executed).toBe(2)
    expect(res.reason).toBe('done')
    expect(d._m.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 2 })
    expect(d._m.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({ used: 2 })
    expect(d._m.get(CONNECT_SENT_KEY)).toEqual(['1', '2'])
    // history records WHO was added + when (with details), for the reports view
    const history = d._m.get(CONNECT_HISTORY_KEY) as ConnectRecord[]
    expect(history).toEqual([
      { memberId: '1', name: '1', headline: 'Recruiter', profileUrl: '/in/1', sentAt: '2026-06-26T00:00:00.000Z' },
      { memberId: '2', name: '2', headline: 'Recruiter', profileUrl: '/in/2', sentAt: '2026-06-26T00:00:00.000Z' }
    ])
  })

  it('returns early when the daily cap is reached (even if the week has room)', async () => {
    const d = deps()
    // dailyConnectCap(100) = 14 → seed today at the cap so the day is exhausted.
    d._m.set(CONNECT_DAY_BUDGET_KEY, { day: '2026-06-26', used: 14 })
    const res = await runConnectStep(d)
    expect(res.executed).toBe(0)
    expect(d.harvest).not.toHaveBeenCalled()
  })

  it('skips already-sent candidates across runs', async () => {
    const d = deps()
    d._m.set(CONNECT_SENT_KEY, ['1'])
    const res = await runConnectStep(d)
    expect(d.connect).toHaveBeenCalledTimes(1)
    expect(res.executed).toBe(1)
  })

  it('returns early when the module is disabled', async () => {
    const d = deps()
    d._m.set('modules:state', [{ id: 'smart_connect', enabled: false, available: true, automationLevel: 'manual', dailyLimit: 100 }])
    const res = await runConnectStep(d)
    expect(res).toEqual({ executed: 0, skipped: 0, reason: 'disabled' })
    expect(d.navigate).not.toHaveBeenCalled()
  })

  it('returns early when the weekly budget is exhausted', async () => {
    const d = deps()
    d._m.set(CONNECT_WEEK_BUDGET_KEY, { week: '2026-W26', used: 100 })
    const res = await runConnectStep(d)
    expect(res.reason).toBe('budget')
    expect(d.harvest).not.toHaveBeenCalled()
  })

  // A run reads persisted storage ONLY: no keywords saved → safe no-op + honest report signal.
  // (The Modules card persists its prefill on open, so a seen-in-the-card value is always saved;
  // this path is the "card never opened / keywords wiped" case — must not connect on a guess.)
  it('returns early when there are no search keywords', async () => {
    const d = deps()
    d._m.set('connect:settings', { searchKeywords: '' })
    const res = await runConnectStep(d)
    expect(res.reason).toBe('no_keywords')
    expect(d.navigate).not.toHaveBeenCalled()
  })

  it('reports nav_failed when the search page never confirmed loaded', async () => {
    const d = deps({ navigate: vi.fn(async () => false) })
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 0, reason: 'nav_failed' })
    expect(d.harvest).not.toHaveBeenCalled()
    expect(d.connect).not.toHaveBeenCalled()
  })

  it('reports empty_search when the people-search rendered zero results', async () => {
    const d = deps({ harvest: vi.fn(async () => ({ candidates: [], outcome: 'empty' as const })) })
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 0, reason: 'empty_search' })
    expect(d.connect).not.toHaveBeenCalled()
  })

  it('reports not_ready when the search page never rendered its cards', async () => {
    const d = deps({ harvest: vi.fn(async () => ({ candidates: [], outcome: 'not_ready' as const })) })
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 0, reason: 'not_ready' })
  })

  // The saturated-pool bug: over weeks Vlad invited everyone on page 1, so its cards are all
  // "Pending" → harvest returns none_connectable. The step must NOT bail (that's what left
  // "connects 0 every run") — it pages deeper to the sparse still-connectable recruiters.
  it('pages PAST an all-Pending page (none_connectable) to reach connectable people deeper', async () => {
    let page = 0
    const outcomes = [
      { candidates: [] as PersonCandidate[], outcome: 'none_connectable' as const }, // page 1: all Pending
      { candidates: [cand('3'), cand('4')], outcome: 'ok' as const }                 // page 2: connectable
    ]
    const d = deps({
      harvest: vi.fn(async () => outcomes[page] ?? { candidates: [], outcome: 'empty' as const }),
      nextPage: vi.fn(async () => { page++; return page < outcomes.length })
    })
    const res = await runConnectStep(d)
    expect(d.connect).toHaveBeenCalledTimes(2)
    expect(res).toMatchObject({ executed: 2, reason: 'done' })
  })

  // Whole search saturated: every page all-Pending. Honest reason (not the lying not_ready)
  // so the report tells Vlad to broaden/rotate keywords instead of "page didn't load".
  it('reports pool_pending when EVERY walked page is all-Pending (nobody connectable anywhere)', async () => {
    const d = deps({
      harvest: vi.fn(async () => ({ candidates: [] as PersonCandidate[], outcome: 'none_connectable' as const })),
      nextPage: vi.fn(async () => true) // always another page; bounded by CONNECT_MAX_PAGES
    })
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 0, reason: 'pool_pending' })
    expect(d.connect).not.toHaveBeenCalled()
    expect(d.harvest.mock.calls.length).toBeGreaterThan(1) // walked past page 1, up to the cap
  })

  it('reports none_fresh when everyone harvested was already invited', async () => {
    const d = deps()
    d._m.set(CONNECT_SENT_KEY, ['1', '2'])
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 0, reason: 'none_fresh' })
    expect(d.connect).not.toHaveBeenCalled()
  })

  it('surfaces the executeConnect failure reason when every invite attempt fails', async () => {
    const d = deps({ connect: vi.fn(async () => ({ ok: false, reason: 'send_button_not_found' })) })
    const res = await runConnectStep(d)
    expect(d.connect).toHaveBeenCalledTimes(2) // it DID try
    expect(res).toMatchObject({ executed: 0, reason: 'send_button_not_found' })
    expect(d._m.get(CONNECT_SENT_KEY)).toBeUndefined() // nothing persisted
  })

  it('reports unreachable when the connect action gets no response', async () => {
    const d = deps({ connect: vi.fn(async () => undefined) })
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 0, reason: 'unreachable' })
  })

  it('reports done when at least one invite succeeds (mixed results)', async () => {
    let n = 0
    const d = deps({ connect: vi.fn(async () => (++n === 1 ? { ok: true } : { ok: false, reason: 'modal_did_not_close' })) })
    const res = await runConnectStep(d)
    expect(res).toMatchObject({ executed: 1, reason: 'done' })
  })

  it('paginates: harvests+connects page 1, then page 2 (anchors are only on the CURRENT page)', async () => {
    // The whole point of per-page: a candidate's Connect anchor exists only while its page
    // is in the DOM. Harvest one page, connect its fresh candidates, THEN advance.
    let page = 0
    const pages = [[cand('1'), cand('2')], [cand('3')]]
    const d = deps({
      harvest: vi.fn(async () => ({ candidates: pages[page] ?? [], outcome: 'ok' as const })),
      nextPage: vi.fn(async () => { page++; return page < pages.length })
    })
    const res = await runConnectStep(d)
    expect(d.harvest).toHaveBeenCalledTimes(2)        // page 1 then page 2
    expect(d.nextPage).toHaveBeenCalledTimes(2)       // advanced after page 1 (true) + page 2 (false → stop)
    expect(d.connect).toHaveBeenCalledTimes(3)        // 1,2 on page 1; 3 on page 2
    expect(res).toMatchObject({ executed: 3, reason: 'done' })
  })

  it('STOPS mid-loop when the run is cancelled (STOP must interrupt a long connect pass)', async () => {
    const d = deps()
    let calls = 0
    d.connect = vi.fn(async () => { calls++; return { ok: true } })
    // cancel after the first successful connect
    d.cancelled = vi.fn(async () => calls >= 1)
    const res = await runConnectStep(d)
    expect(res.executed).toBe(1)       // sent one, then stopped — did NOT process the 2nd candidate
    expect(d.connect).toHaveBeenCalledTimes(1)
    expect(res.reason).toBe('cancelled')
  })

  it('pymk source navigates to /mynetwork/ and skips the keyword gate', async () => {
    const d = deps()
    d._m.set('connect:settings', { searchKeywords: '' }) // нет ключей — не важно для PYMK
    const res = await runConnectStep(d, { source: 'pymk' })
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/')
    expect(res.reason).not.toBe('no_keywords')
    expect(d.connect).toHaveBeenCalledTimes(2) // harvest дефолтно даёт 2
  })

  it('search source still gates on keywords (unchanged)', async () => {
    const d = deps()
    d._m.set('connect:settings', { searchKeywords: '' })
    const res = await runConnectStep(d) // default source 'search'
    expect(res.reason).toBe('no_keywords')
    expect(d.navigate).not.toHaveBeenCalled()
  })
})

describe('runConnectWithFallback', () => {
  const noHarvest = async () => ({ candidates: [] as PersonCandidate[], outcome: 'empty' as const })

  it('runs PYMK fallback when search yields 0 connects', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) }) // search пуст
    const pymkHarvest = vi.fn(async () => ({ candidates: [cand('7'), cand('8')], outcome: 'ok' as const }))
    const res = await runConnectWithFallback({ ...d, pymkHarvest, nextPage: vi.fn(async () => false) })
    expect(pymkHarvest).toHaveBeenCalled()
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/')
    expect(res).toMatchObject({ executed: 2, reason: 'done' })
  })

  it('does NOT run PYMK when search already connected someone', async () => {
    const d = deps() // harvest дефолтно 2 connectable
    const pymkHarvest = vi.fn(noHarvest)
    const res = await runConnectWithFallback({ ...d, pymkHarvest })
    expect(pymkHarvest).not.toHaveBeenCalled()
    expect(res.executed).toBe(2)
  })

  it('does NOT run PYMK when the module is disabled or budget is 0', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) })
    d._m.set('modules:state', [{ id: 'smart_connect', enabled: false, available: true, automationLevel: 'manual', dailyLimit: 100 }])
    const pymkHarvest = vi.fn(noHarvest)
    const res = await runConnectWithFallback({ ...d, pymkHarvest })
    expect(pymkHarvest).not.toHaveBeenCalled()
    expect(res.reason).toBe('disabled')
  })

  it('reports pymk_dry when both search and PYMK yield 0', async () => {
    const d = deps({ harvest: vi.fn(noHarvest) })
    const pymkHarvest = vi.fn(noHarvest)
    const res = await runConnectWithFallback({ ...d, pymkHarvest, nextPage: vi.fn(async () => false) })
    expect(res).toMatchObject({ executed: 0, reason: 'pymk_dry' })
  })
})
