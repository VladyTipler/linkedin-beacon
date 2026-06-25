import { describe, it, expect } from 'vitest'
import { IdeaExtractor, parseIdeas } from './IdeaExtractor'
import type { LlmProvider, LlmRequest } from '@lib/llm/contracts'
import type { ExpertiseProfile, FeedItem } from '@lib/types'

function fakeProvider(reply: string) {
  const calls: LlmRequest[] = []
  const provider: LlmProvider = {
    id: 'gemini',
    async complete(req) {
      calls.push(req)
      return { text: reply, model: 'fake', provider: 'gemini' }
    },
    async listModels() { return [] }
  }
  return { provider, calls }
}

const posts: FeedItem[] = [
  { id: '1', author: 'Dev A', excerpt: 'Everyone is rewriting REST to tRPC lately' },
  { id: '2', author: 'Dev B', excerpt: 'AI code review is changing how we ship' }
]
const expertise: ExpertiseProfile = {
  headline: 'Frontend TechLead',
  stack: ['Vue', 'TypeScript'],
  bio: '11y, AI-native tooling'
}

describe('IdeaExtractor', () => {
  it('parses a JSON array of ideas from the model', async () => {
    const { provider } = fakeProvider(
      JSON.stringify([
        { topic: 'tRPC vs REST', angle: 'type-safety lessons from a Vue codebase' },
        { topic: 'AI code review', angle: 'what it misses vs a senior reviewer' }
      ])
    )
    const ideas = await new IdeaExtractor(provider).extract(posts, expertise)
    expect(ideas).toHaveLength(2)
    expect(ideas[0]).toEqual({
      topic: 'tRPC vs REST',
      angle: 'type-safety lessons from a Vue codebase'
    })
  })

  it('tolerates a ```json fenced response', async () => {
    const { provider } = fakeProvider(
      '```json\n[{"topic":"X","angle":"Y"}]\n```'
    )
    const ideas = await new IdeaExtractor(provider).extract(posts, expertise)
    expect(ideas).toEqual([{ topic: 'X', angle: 'Y' }])
  })

  it('feeds post signals, the user stack and an anti-copy instruction to the model', async () => {
    const { provider, calls } = fakeProvider('[]')
    await new IdeaExtractor(provider).extract(posts, expertise)
    const joined = calls[0].messages.map((m) => m.content).join('\n').toLowerCase()
    expect(joined).toContain('trpc') // signal from the feed
    expect(joined).toContain('vue') // user expertise
    expect(joined).toContain('do not copy') // anti-slop framing
  })

  it('drops malformed entries that lack topic or angle', async () => {
    const { provider } = fakeProvider(
      JSON.stringify([{ topic: 'ok', angle: 'good' }, { topic: 'no angle' }, { angle: 'no topic' }])
    )
    const ideas = await new IdeaExtractor(provider).extract(posts, expertise)
    expect(ideas).toEqual([{ topic: 'ok', angle: 'good' }])
  })

  it('throws when the response is not parseable as ideas', async () => {
    const { provider } = fakeProvider('the model rambled without any JSON')
    await expect(new IdeaExtractor(provider).extract(posts, expertise)).rejects.toThrow()
  })
})

describe('parseIdeas spark grounding', () => {
  it('maps sourceIndex (1-based) to provenance + keeps claim/quote', () => {
    const raw = JSON.stringify([
      { topic: 'Architecture', angle: 'Pragmatism', sourceIndex: 1, claim: 'Speed over purity', quote: 'ship fast' }
    ])
    const [idea] = parseIdeas(raw, posts)
    expect(idea.spark).toEqual({
      claim: 'Speed over purity',
      quote: 'ship fast',
      source: { author: 'Dev A', id: '1' }
    })
  })

  it('keeps the idea but omits spark when claim is missing', () => {
    const [idea] = parseIdeas(JSON.stringify([{ topic: 'T', angle: 'A', sourceIndex: 2 }]), posts)
    expect(idea).toEqual({ topic: 'T', angle: 'A' })
    expect(idea.spark).toBeUndefined()
  })

  it('builds spark without source when sourceIndex is out of range', () => {
    const [idea] = parseIdeas(JSON.stringify([{ topic: 'T', angle: 'A', claim: 'C', quote: 'Q', sourceIndex: 9 }]), posts)
    expect(idea.spark).toEqual({ claim: 'C', quote: 'Q' })
  })

  it('still drops entries missing topic or angle', () => {
    const raw = JSON.stringify([{ topic: '', angle: 'A', claim: 'C' }, { topic: 'T', angle: 'A2' }])
    expect(parseIdeas(raw, posts).map((i) => i.angle)).toEqual(['A2'])
  })

  it('throws an actionable code when the model returns prose (no JSON array)', () => {
    expect(() => parseIdeas('Sure! Here are some ideas you could write about.', posts)).toThrow(
      'ideas_not_json'
    )
  })
})
