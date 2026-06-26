import { describe, it, expect, vi } from 'vitest'
import { runConnectStep } from './connectHandlers'
import { CONNECT_WEEK_BUDGET_KEY, CONNECT_DAY_BUDGET_KEY } from '@lib/connect/ConnectWeekBudget'
import { CONNECT_SENT_KEY } from './connectHandlers'
import type { PersonCandidate } from '@lib/types'

function deps(over: Partial<Record<string, unknown>> = {}) {
  const m = new Map<string, unknown>()
  m.set('modules:state', [{ id: 'smart_connect', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 100 }])
  m.set('connect:settings', { searchKeywords: 'frontend recruiter' })
  const cand = (id: string): PersonCandidate => ({ memberId: id, name: id, headline: 'Recruiter', profileUrl: `/in/${id}` })
  return {
    store: { get: async <T>(k: string) => (m.get(k) as T) ?? null, set: async (k: string, v: unknown) => void m.set(k, v) },
    clock: { now: () => new Date('2026-06-26T00:00:00Z') },
    rng: { next: () => 1 }, // no downward jitter → dailyShare = 14
    navigate: vi.fn(async () => {}),
    harvest: vi.fn(async () => [cand('1'), cand('2')]),
    connect: vi.fn(async () => ({ ok: true })),
    pace: vi.fn(async () => {}),
    _m: m,
    ...over
  }
}

describe('runConnectStep', () => {
  it('navigates, harvests, connects fresh candidates, records week + sent-set', async () => {
    const d = deps()
    const res = await runConnectStep(d)
    expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/search/results/people/?keywords=frontend%20recruiter')
    expect(d.connect).toHaveBeenCalledTimes(2)
    expect(res.executed).toBe(2)
    expect(d._m.get(CONNECT_WEEK_BUDGET_KEY)).toMatchObject({ used: 2 })
    expect(d._m.get(CONNECT_DAY_BUDGET_KEY)).toMatchObject({ used: 2 })
    expect(d._m.get(CONNECT_SENT_KEY)).toEqual(['1', '2'])
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

  it('returns early when there are no search keywords', async () => {
    const d = deps()
    d._m.set('connect:settings', { searchKeywords: '' })
    const res = await runConnectStep(d)
    expect(res.reason).toBe('no_keywords')
  })
})
