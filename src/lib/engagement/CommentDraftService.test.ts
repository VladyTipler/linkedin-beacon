import { describe, it, expect } from 'vitest'
import { CommentDraftService } from './CommentDraftService'
import type { LlmProvider, LlmRequest } from '@lib/llm/contracts'
import type { CommentDraftInput } from './CommentDraftService'

function fakeProvider(reply: string) {
  const calls: LlmRequest[] = []
  const provider: LlmProvider = {
    id: 'openrouter',
    async complete(req) {
      calls.push(req)
      return { text: reply, model: 'fake', provider: 'openrouter' }
    }
  }
  return { provider, calls }
}

const input: CommentDraftInput = {
  post: {
    urn: 'urn:li:activity:9',
    authorName: 'Anna',
    authorHeadline: 'Recruiter',
    text: 'How do you handle SSR hydration mismatches?'
  },
  expertise: { headline: 'Frontend TechLead', stack: ['Vue', 'TypeScript'], bio: '11y' },
  tone: 'expert'
}

describe('CommentDraftService', () => {
  it('returns the provider completion, trimmed', async () => {
    const { provider } = fakeProvider('  In our Vue SSR work we gate hydration on idle.  ')
    const out = await new CommentDraftService(provider).draft(input)
    expect(out).toBe('In our Vue SSR work we gate hydration on idle.')
  })

  it('feeds the post text, the user expertise and the tone to the model', async () => {
    const { provider, calls } = fakeProvider('ok')
    await new CommentDraftService(provider).draft(input)
    const joined = calls[0].messages.map((m) => m.content).join('\n').toLowerCase()
    expect(joined).toContain('ssr hydration mismatches')
    expect(joined).toContain('vue')
    expect(joined).toContain('expert')
  })

  it('sends a system instruction (anti-slop framing) plus the user prompt', async () => {
    const { provider, calls } = fakeProvider('ok')
    await new CommentDraftService(provider).draft(input)
    expect(calls[0].messages.some((m) => m.role === 'system')).toBe(true)
    expect(calls[0].messages.some((m) => m.role === 'user')).toBe(true)
  })
})
