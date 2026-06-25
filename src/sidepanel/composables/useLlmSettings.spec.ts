import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useLlmSettings } from './useLlmSettings'

// chrome.storage.local mock
const mem = new Map<string, unknown>()
beforeEach(() => {
  mem.clear()
  ;(globalThis as any).chrome = {
    runtime: { id: 'x', sendMessage: vi.fn().mockResolvedValue([{ id: 'm1', label: 'M1' }]) },
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: mem.get(k) })),
        set: vi.fn(async (o: Record<string, unknown>) => { for (const k in o) mem.set(k, o[k]) })
      }
    }
  }
})

describe('useLlmSettings', () => {
  it('saves and reloads the config', async () => {
    const s = useLlmSettings()
    s.config.value = { provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' }
    await s.save()
    const s2 = useLlmSettings()
    await s2.load()
    expect(s2.config.value).toEqual({ provider: 'gemini', apiKey: 'AIza', model: 'gemini-2.5-flash' })
  })

  it('sets keyValid true when models are returned', async () => {
    const s = useLlmSettings()
    await s.fetchModels()
    expect(s.keyValid.value).toBe(true)
    expect(s.models.value.length).toBe(1)
  })

  it('sets keyValid false when the request fails (null)', async () => {
    ;(globalThis as any).chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('no sw'))
    const s = useLlmSettings()
    await s.fetchModels()
    expect(s.keyValid.value).toBe(false)
  })

  it('filters models by the search query', async () => {
    const s = useLlmSettings()
    s.models.value = [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini' }
    ]
    s.modelQuery.value = 'gemini'
    expect(s.filteredModels.value.map((m) => m.id)).toEqual(['google/gemini-2.5-flash'])
  })

  it('caps the dropdown at 10 results (OpenRouter returns hundreds)', () => {
    const s = useLlmSettings()
    s.models.value = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }))
    expect(s.filteredModels.value.length).toBe(10)
    s.modelQuery.value = 'm1' // matches m1, m10..m19 = 11 → still capped
    expect(s.filteredModels.value.length).toBe(10)
  })
})
