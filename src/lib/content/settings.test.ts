import { describe, it, expect } from 'vitest'
import { loadContentSettings, saveContentSettings, DEFAULT_POST_PROMPT } from './settings'
import type { KeyValueStore } from '@lib/ports'

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

describe('content settings', () => {
  it('returns the default prompt when unset', async () => {
    const s = await loadContentSettings(memStore())
    expect(s.postPrompt).toBe(DEFAULT_POST_PROMPT)
  })

  it('round-trips a custom prompt', async () => {
    const store = memStore()
    await saveContentSettings(store, { postPrompt: 'Write like a pirate.' })
    expect((await loadContentSettings(store)).postPrompt).toBe('Write like a pirate.')
  })
})
