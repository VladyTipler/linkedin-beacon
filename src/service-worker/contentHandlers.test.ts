import { describe, it, expect } from 'vitest'
import { generateDraft } from './contentHandlers'
import type { KeyValueStore, Clock } from '@lib/ports'
import type { HttpClient, HttpGet } from '@lib/llm/contracts'

function memStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const m = new Map<string, unknown>(Object.entries(initial))
  return {
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
  }
}

/** Returns a real-shape OpenRouter completion whose content is `text`. */
function fakeHttp(text: string): HttpClient & HttpGet {
  return {
    async postJson<T>() { return { choices: [{ message: { content: text } }] } as T },
    async getJson<T>() { return {} as T }
  }
}

const CONFIGURED = {
  'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
  'engagement:settings': {
    config: { level: 'manual' }, target: { stack: [] },
    expertise: { headline: 'Frontend TechLead', stack: ['Vue'] }, relevanceThreshold: 0.3
  }
}

const fixedClock: Clock = { now: () => new Date('2026-06-25T00:00:00.000Z') }

describe('generateDraft', () => {
  it('errors no_key when the key is empty', async () => {
    const res = await generateDraft(
      { store: memStore(), http: fakeHttp('x'), clock: fixedClock, newId: () => 'id1' },
      { topic: 'T', angle: 'A' }
    )
    expect(res).toEqual({ draft: null, error: 'no_key' })
  })

  it('generates a post via the LLM and stores the draft', async () => {
    const store = memStore(CONFIGURED)
    const res = await generateDraft(
      { store, http: fakeHttp('My post body.'), clock: fixedClock, newId: () => 'id1' },
      { topic: 'tRPC vs REST', angle: 'type-safety from Vue' }
    )
    expect(res.error).toBeUndefined()
    expect(res.draft).toEqual({
      id: 'id1',
      ideaTopic: 'tRPC vs REST',
      ideaAngle: 'type-safety from Vue',
      text: 'My post body.',
      createdAt: '2026-06-25T00:00:00.000Z'
    })
    expect(await store.get('content:drafts')).toEqual([res.draft])
  })
})
