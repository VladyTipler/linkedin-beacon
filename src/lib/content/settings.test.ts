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
  it('returns the default prompt and comments off by default when unset', async () => {
    const s = await loadContentSettings(memStore())
    expect(s.postPrompt).toBe(DEFAULT_POST_PROMPT)
    expect(s.commentsEnabled).toBe(false)
    expect(s.commentsPerDay).toBe(5)
    expect(s.commentTone).toBe('expert')
    expect(s.postsPerWeek).toBe(3)
  })

  it('round-trips custom prompt + comment config', async () => {
    const store = memStore()
    await saveContentSettings(store, {
      postPrompt: 'Write like a pirate.',
      commentsEnabled: true,
      commentsPerDay: 3,
      commentTone: 'friendly',
      postsPerWeek: 5
    })
    const s = await loadContentSettings(store)
    expect(s.postPrompt).toBe('Write like a pirate.')
    expect(s.commentsEnabled).toBe(true)
    expect(s.commentsPerDay).toBe(3)
    expect(s.commentTone).toBe('friendly')
    expect(s.postsPerWeek).toBe(5)
  })
})
