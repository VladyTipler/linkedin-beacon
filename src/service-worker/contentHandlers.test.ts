import { describe, it, expect } from 'vitest'
import { commentOnPost, extractRunIdeas, generateDraft, generateIdeas, publishPost, publishApprovedDrafts } from './contentHandlers'
import type { KeyValueStore, Clock } from '@lib/ports'
import { DraftStore } from '@lib/content/DraftStore'
import { isoWeekKey } from '@lib/content/PostWeekBudget'
import type { HttpClient, HttpGet } from '@lib/llm/contracts'
import type { Draft, FeedPost } from '@lib/types'

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

describe('publishPost', () => {
  const draft: Draft = {
    id: 'd1', ideaTopic: 'T', ideaAngle: 'A', text: 'Hello world',
    createdAt: '2026-06-26T00:00:00.000Z'
  }
  const base = () => memStore({ 'content:drafts': [draft], 'content:settings': { postsPerWeek: 3 } })

  it('not_found when the draft id is unknown', async () => {
    const res = await publishPost(
      { store: base(), clock: fixedClock, publish: async () => ({ ok: true }) },
      'missing'
    )
    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })

  it('budget when the week cap is exhausted', async () => {
    const store = memStore({
      'content:drafts': [draft], 'content:settings': { postsPerWeek: 1 },
      'posts:budget': { week: '2026-W26', used: 1 }
    })
    const res = await publishPost(
      { store, clock: fixedClock, publish: async () => ({ ok: true }) },
      'd1'
    )
    expect(res).toEqual({ ok: false, reason: 'budget' })
  })

  it('publishes: removes the draft and records the week budget', async () => {
    const store = base()
    let publishedText = ''
    const res = await publishPost(
      { store, clock: fixedClock, publish: async (t) => { publishedText = t; return { ok: true } } },
      'd1'
    )
    expect(res).toEqual({ ok: true })
    expect(publishedText).toBe('Hello world')
    expect(await store.get('content:drafts')).toEqual([])
    expect(await store.get('posts:budget')).toEqual({ week: '2026-W26', used: 1 })
  })

  it('keeps the draft and surfaces the reason when the DOM publish fails', async () => {
    const store = base()
    const res = await publishPost(
      { store, clock: fixedClock, publish: async () => ({ ok: false, reason: 'post_button_disabled' }) },
      'd1'
    )
    expect(res).toEqual({ ok: false, reason: 'post_button_disabled' })
    expect(await store.get('content:drafts')).toEqual([draft])
  })
})

/** Captures each postJson body so we can assert what reached the LLM wire. */
function capturingHttp(text = 'A specific, real take from my own Vue experience here.'): {
  http: HttpClient & HttpGet
  bodies: unknown[]
} {
  const bodies: unknown[] = []
  return {
    bodies,
    http: {
      async postJson<T>(_url: string, body: unknown) {
        bodies.push(body)
        return { choices: [{ message: { content: text } }] } as T
      },
      async getJson<T>() {
        return {} as T
      }
    }
  }
}

const allDays = { 'content:settings': { publishDays: [0,1,2,3,4,5,6], postsPerWeek: 3 } }
const approvedDraft = { id: 'a', ideaTopic: 't', ideaAngle: 'g', text: 'hello', createdAt: '2026-06-01T00:00:00Z', approved: true }
const clock = { now: () => new Date('2026-06-26T10:00:00Z') }

describe('publishApprovedDrafts', () => {
  it('publishes the oldest approved draft, consumes it, records the week', async () => {
    const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [approvedDraft] })
    let prepared = false
    const r = await publishApprovedDrafts({
      store, clock,
      prepare: async () => { prepared = true },
      publish: async () => ({ ok: true })
    })
    expect(r.published).toBe(1)
    expect(prepared).toBe(true)
    expect(await new DraftStore(store).all()).toEqual([])                 // consumed
    expect((await store.get('posts:budget') as any).used).toBe(1)        // week recorded
  })

  it('does NOT publish (or prepare) when today is not a publish day', async () => {
    const store = memStore({ ...CONTENT_MODS, 'content:settings': { publishDays: [], postsPerWeek: 3 }, 'content:drafts': [approvedDraft] })
    let prepared = false
    const r = await publishApprovedDrafts({ store, clock, prepare: async () => { prepared = true }, publish: async () => ({ ok: true }) })
    expect(r.published).toBe(0); expect(prepared).toBe(false)
    expect((await new DraftStore(store).all()).length).toBe(1)           // kept
  })

  it('skips when there is no approved draft', async () => {
    const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [{ ...approvedDraft, approved: false }] })
    const r = await publishApprovedDrafts({ store, clock, prepare: async () => {}, publish: async () => ({ ok: true }) })
    expect(r.published).toBe(0)
  })

  it('skips when the weekly cap is exhausted', async () => {
    const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [approvedDraft], 'posts:budget': { week: isoWeekKey(clock.now()), used: 3 } })
    const r = await publishApprovedDrafts({ store, clock, prepare: async () => {}, publish: async () => ({ ok: true }) })
    expect(r.published).toBe(0)
  })

  it('keeps the draft + reports reason when the composer publish fails', async () => {
    const store = memStore({ ...CONTENT_MODS, ...allDays, 'content:drafts': [approvedDraft] })
    const r = await publishApprovedDrafts({ store, clock, prepare: async () => {}, publish: async () => ({ ok: false, reason: 'post_button_disabled' }) })
    expect(r).toEqual({ published: 0, reason: 'post_button_disabled' })
    expect((await new DraftStore(store).all()).length).toBe(1)
  })
})

describe('content language reaches the LLM wire', () => {
  it('generateDraft injects the configured language into the post request', async () => {
    const { http, bodies } = capturingHttp('My post body.')
    const store = memStore({ ...CONFIGURED, 'content:settings': { contentLanguage: 'en' } })
    await generateDraft({ store, http, clock: fixedClock, newId: () => 'id1' }, { topic: 'T', angle: 'A' })
    expect(JSON.stringify(bodies[0])).toMatch(/English/)
  })

  it('commentOnPost injects the configured language into the comment request', async () => {
    const { http, bodies } = capturingHttp()
    const store = memStore({ ...COMMENT_CFG, 'content:settings': { commentsEnabled: true, commentsPerDay: 5, commentTone: 'expert', contentLanguage: 'en' } })
    await commentOnPost({ store, http, clock: fixedClock }, RELEVANT_POST)
    expect(JSON.stringify(bodies[0])).toMatch(/English/)
  })
})
