import { describe, it, expect } from 'vitest'
import { commentOnPost, extractRunIdeas, generateDraft, generateIdeas } from './contentHandlers'
import type { KeyValueStore, Clock } from '@lib/ports'
import type { HttpClient, HttpGet } from '@lib/llm/contracts'
import type { FeedPost } from '@lib/types'

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

const posts: FeedPost[] = [{ urn: 'urn:1', authorName: 'A', text: 'hiring vue devs' }]

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

describe('generateIdeas', () => {
  it('errors no_key when the key is empty', async () => {
    const res = await generateIdeas({ store: memStore(), http: fakeHttp('[]'), harvest: async () => posts })
    expect(res).toEqual({ ideas: [], error: 'no_key' })
  })

  it('errors no_expertise when the headline is blank', async () => {
    const store = memStore({ 'llm:config': { provider: 'openrouter', apiKey: 'sk-1' } })
    const res = await generateIdeas({ store, http: fakeHttp('[]'), harvest: async () => posts })
    expect(res).toEqual({ ideas: [], error: 'no_expertise' })
  })

  it('errors no_feed when harvest is empty', async () => {
    const res = await generateIdeas({ store: memStore(CONFIGURED), http: fakeHttp('[]'), harvest: async () => [] })
    expect(res).toEqual({ ideas: [], error: 'no_feed' })
  })

  it('extracts ideas via the LLM and banks them', async () => {
    const ideasJson = JSON.stringify([{ topic: 'tRPC vs REST', angle: 'type-safety from Vue' }])
    const store = memStore(CONFIGURED)
    const res = await generateIdeas({ store, http: fakeHttp(ideasJson), harvest: async () => posts })
    expect(res.error).toBeUndefined()
    expect(res.ideas).toContainEqual({ topic: 'tRPC vs REST', angle: 'type-safety from Vue' })
    // persisted to the bank
    expect(await store.get('ideas:bank')).toEqual([{ topic: 'tRPC vs REST', angle: 'type-safety from Vue' }])
  })
})

const CONTENT_MODS = {
  'modules:state': [{ id: 'content', enabled: true, available: true, automationLevel: 'manual', dailyLimit: 5 }]
}
const SPARK_JSON = JSON.stringify([
  { topic: 'Architecture', angle: 'Pragmatism', sourceIndex: 1, claim: 'Speed over purity', quote: 'ship fast' }
])

describe('extractRunIdeas (LLM boundary)', () => {
  it('banks sparked ideas from the supplied buffer and records the day budget', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS })
    const res = await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)
    expect(res.stored).toBe(1)
    const bank = (await store.get('ideas:bank')) as any[]
    expect(bank[0].spark.source).toEqual({ author: 'A', id: 'urn:1' })
    expect(await store.get('ideas:budget')).toEqual({ day: '2026-06-25', used: 1 })
  })

  it('errors no_key without calling the model when the key is empty', async () => {
    const store = memStore({ ...CONTENT_MODS })
    expect(await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)).toEqual({
      stored: 0,
      error: 'no_key'
    })
  })

  it('skips extraction silently when the daily budget is exhausted', async () => {
    const store = memStore({ ...CONFIGURED, ...CONTENT_MODS, 'ideas:budget': { day: '2026-06-25', used: 5 } })
    expect(await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)).toEqual({ stored: 0 })
  })

  it('returns stored:0 (no extraction) when the content module is disabled', async () => {
    const store = memStore({
      ...CONFIGURED,
      'modules:state': [{ id: 'content', enabled: false, available: true, automationLevel: 'manual', dailyLimit: 5 }]
    })
    expect(await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)).toEqual({ stored: 0 })
  })

  it('errors no_expertise when the headline is blank', async () => {
    const store = memStore({ 'llm:config': { provider: 'openrouter', apiKey: 'sk-1' }, ...CONTENT_MODS })
    expect(await extractRunIdeas({ store, http: fakeHttp(SPARK_JSON), clock: fixedClock }, posts)).toEqual({
      stored: 0,
      error: 'no_expertise'
    })
  })
})

const RELEVANT_POST: FeedPost = {
  urn: 'urn:c',
  authorName: 'Anna',
  authorHeadline: 'Technical recruiter',
  text: 'we are hiring vue engineers'
}
const COMMENT_CFG = {
  'llm:config': { provider: 'openrouter', apiKey: 'sk-1' },
  'engagement:settings': {
    config: { level: 'manual' },
    target: { stack: ['vue'], targetRoles: ['recruiter'], geos: [], watchlistCompanies: [] },
    expertise: { headline: 'Vue TechLead', stack: ['Vue'] },
    relevanceThreshold: 0.3
  },
  'content:settings': { commentsEnabled: true, commentsPerDay: 5, commentTone: 'expert' }
}
const COMMENT_TEXT = 'Sharp, specific take from my own Vue experience here.'

describe('commentOnPost (LLM boundary)', () => {
  it('generates + judges a comment for a relevant post and records the budget', async () => {
    const store = memStore({ ...COMMENT_CFG })
    const res = await commentOnPost({ store, http: fakeHttp(COMMENT_TEXT), clock: fixedClock }, RELEVANT_POST)
    expect(res.ok).toBe(true)
    expect(res.text).toContain('Vue')
    expect(await store.get('comments:budget')).toEqual({ day: '2026-06-25', used: 1 })
  })

  it('skips when comments are disabled', async () => {
    const store = memStore({ ...COMMENT_CFG, 'content:settings': { commentsEnabled: false } })
    expect((await commentOnPost({ store, http: fakeHttp('x'), clock: fixedClock }, RELEVANT_POST)).ok).toBe(false)
  })

  it('skips an off-target post (not relevant)', async () => {
    const store = memStore({ ...COMMENT_CFG })
    const offtopic: FeedPost = { urn: 'o', authorName: 'B', text: 'nice weather today everyone' }
    expect(await commentOnPost({ store, http: fakeHttp('x'), clock: fixedClock }, offtopic)).toEqual({
      ok: false,
      reason: 'not_relevant'
    })
  })

  it('skips when the daily comment budget is exhausted', async () => {
    const store = memStore({ ...COMMENT_CFG, 'comments:budget': { day: '2026-06-25', used: 5 } })
    expect(await commentOnPost({ store, http: fakeHttp('x'), clock: fixedClock }, RELEVANT_POST)).toEqual({
      ok: false,
      reason: 'budget'
    })
  })
})
