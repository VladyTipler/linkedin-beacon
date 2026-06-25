import type { LlmProvider } from '../llm/contracts'
import type { CommentTone, ExpertiseProfile, FeedPost } from '../types'

export interface CommentDraftInput {
  post: FeedPost
  expertise: ExpertiseProfile
  tone: CommentTone
  /** Language for the generated comment (defaults handled by the caller). */
  language: string
}

const TONE_HINT: Record<CommentTone, string> = {
  expert: 'an expert, opinionated take that adds a concrete insight',
  friendly: 'a warm, encouraging note that still says something specific',
  question: 'a sharp, genuine question that moves the discussion forward'
}

/**
 * Drafts a LinkedIn comment for a feed post via the LLM port (design-spec §4.1).
 * Anti-slop framing (§4.3.1): the model must NOT restate/summarise the post or
 * use generic praise — it adds a specific point from the user's own expertise.
 * Pure w.r.t. an injected LlmProvider, so it's tested on a fake (no network).
 */
export class CommentDraftService {
  constructor(private readonly provider: LlmProvider) {}

  async draft(input: CommentDraftInput): Promise<string> {
    const { post, expertise, tone, language } = input
    const system = [
      'You write LinkedIn comments in the first person as the user.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      expertise.bio ? `Background: ${expertise.bio}.` : '',
      'Rules: one or two sentences, under 280 characters.',
      `Write the comment in ${language}.`,
      'Do NOT restate or summarise the post. No generic praise ("great post").',
      `Add a specific point from the user's own experience. Tone: ${TONE_HINT[tone]}.`
    ]
      .filter(Boolean)
      .join(' ')

    const user = [
      `Post by ${post.authorName}${post.authorHeadline ? ` (${post.authorHeadline})` : ''}:`,
      post.text,
      `Write the ${tone} comment now. Reply with the comment text only.`
    ].join('\n')

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7,
      maxTokens: 160
    })
    return completion.text.trim()
  }
}
