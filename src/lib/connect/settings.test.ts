import { describe, it, expect } from 'vitest'
import { defaultConnectKeywords, loadConnectSettings, saveConnectSettings, CONNECT_SETTINGS_KEY } from './settings'

function fakeStore(initial: Record<string, unknown> = {}) {
  const m = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async <T>(k: string) => (m.get(k) as T) ?? null,
    set: async (k: string, v: unknown) => void m.set(k, v),
    map: m
  }
}

describe('connect settings', () => {
  it('defaults keywords to "<first stack> recruiter", or "recruiter" when no stack', () => {
    expect(defaultConnectKeywords({ headline: '', stack: ['React', 'Vue'] })).toBe('React recruiter')
    expect(defaultConnectKeywords({ headline: '', stack: [] })).toBe('recruiter')
  })

  it('loads stored keywords; empty store → empty keywords + default region US', async () => {
    const empty = fakeStore()
    expect(await loadConnectSettings(empty)).toEqual({ searchKeywords: '', targetRegions: ['US'] })
    const s = fakeStore({ [CONNECT_SETTINGS_KEY]: { searchKeywords: 'devops recruiter' } })
    expect(await loadConnectSettings(s)).toEqual({ searchKeywords: 'devops recruiter', targetRegions: ['US'] })
  })

  it('round-trips keywords + regions via save', async () => {
    const s = fakeStore()
    await saveConnectSettings(s, { searchKeywords: 'qa hiring', targetRegions: ['Europe', 'Asia'] })
    expect(await loadConnectSettings(s)).toEqual({ searchKeywords: 'qa hiring', targetRegions: ['Europe', 'Asia'] })
  })
})
