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

  it('filters models by the search query', async () => {
    const s = useLlmSettings()
    s.models.value = [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini' }
    ]
    s.modelQuery.value = 'gemini'
    expect(s.filteredModels.value.map((m) => m.id)).toEqual(['google/gemini-2.5-flash'])
  })
})
