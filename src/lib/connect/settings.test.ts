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

  it('loads stored keywords; empty store returns empty string (SW fills the default)', async () => {
    const empty = fakeStore()
    expect(await loadConnectSettings(empty)).toEqual({ searchKeywords: '' })
    const s = fakeStore({ [CONNECT_SETTINGS_KEY]: { searchKeywords: 'devops recruiter' } })
    expect(await loadConnectSettings(s)).toEqual({ searchKeywords: 'devops recruiter' })
  })

  it('round-trips via save', async () => {
    const s = fakeStore()
    await saveConnectSettings(s, { searchKeywords: 'qa hiring' })
    expect(await loadConnectSettings(s)).toEqual({ searchKeywords: 'qa hiring' })
  })
})
