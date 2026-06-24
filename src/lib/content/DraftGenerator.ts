import type { LlmProvider } from '../llm/contracts'
import type { ExpertiseProfile, Idea } from '../types'

/**
 * Turns an idea + the user's custom prompt into a full LinkedIn post draft
 * (design-spec §4.3). Anti-slop: the idea is the user's ORIGINAL angle, the
 * custom prompt carries voice/structure, the expertise grounds it in their
 * experience. Behind LlmProvider → fake-tested.
 */
export class DraftGenerator {
  constructor(private readonly provider: LlmProvider) {}

  async generate(idea: Idea, expertise: ExpertiseProfile, postPrompt: string): Promise<string> {
    const system = [
      'You write LinkedIn posts in the user\'s own voice.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      expertise.bio ? `Background: ${expertise.bio}.` : '',
      'Write ONE post. Output only the post text — no preamble, no markdown headers, no quotes.',
      'Never sound like generic AI thought-leadership; be specific and grounded in the user\'s experience.'
    ]
      .filter(Boolean)
      .join(' ')

    const user = [
      `Topic: ${idea.topic}`,
      `My angle: ${idea.angle}`,
      '',
      'Author the post following these instructions:',
      postPrompt
    ].join('\n')

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.8,
      maxTokens: 800
    })
    return completion.text.trim()
  }
}
