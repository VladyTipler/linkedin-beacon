import { describe, it, expect } from 'vitest'
import { DraftGenerator } from './DraftGenerator'
import type { LlmProvider, LlmRequest, LlmCompletion } from '@lib/llm/contracts'
import type { Idea, ExpertiseProfile } from '@lib/types'

class FakeProvider implements LlmProvider {
  readonly id = 'openrouter' as const
  last?: LlmRequest
  constructor(private readonly text: string) {}
  async complete(req: LlmRequest): Promise<LlmCompletion> {
    this.last = req
    return { text: this.text, model: 'm', provider: this.id }
  }
  async listModels() { return [] }
}

const idea: Idea = { topic: 'tRPC vs REST', angle: 'type-safety from a Vue codebase' }
const expertise: ExpertiseProfile = { headline: 'Frontend TechLead, 11y Vue/TS', stack: ['Vue', 'TS'] }

describe('DraftGenerator', () => {
  it('returns the trimmed post text', async () => {
    const gen = new DraftGenerator(new FakeProvider('  Here is the post.  \n'))
    expect(await gen.generate(idea, expertise, 'Write like an expert.')).toBe('Here is the post.')
  })

  it('feeds the idea, expertise and custom prompt into the request', async () => {
    const provider = new FakeProvider('x')
    await new DraftGenerator(provider).generate(idea, expertise, 'MY_CUSTOM_PROMPT')
    const joined = provider.last!.messages.map((m) => m.content).join('\n')
    expect(joined).toContain('tRPC vs REST')
    expect(joined).toContain('type-safety from a Vue codebase')
    expect(joined).toContain('Frontend TechLead')
    expect(joined).toContain('MY_CUSTOM_PROMPT')
  })
})
