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
    // SSI grows through feed ACTIVITY, so the comment engages the post's OWN topic with a
    // question — NOT a niche take filtered to the user's stack (that filtered most posts out
    // and the bot rarely commented). Expertise is voice only, never a relevance gate.
    const system = [
      'You write LinkedIn comments in the first person as the user.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      expertise.bio ? `Background: ${expertise.bio}.` : '',
      `Write the comment in ${language}.`,
      'The comment must ask ONE specific clarifying QUESTION about THIS post\'s topic — a question',
      'that shows you read it and moves the discussion forward (SSI grows through engagement).',
      'Do NOT restate or summarise the post. No generic praise ("great post").',
      'One or two sentences, under 280 characters.',
      `Voice/tone: ${TONE_HINT[tone]}.`
    ]
      .filter(Boolean)
      .join(' ')

    const user = [
      `Post by ${post.authorName}${post.authorHeadline ? ` (${post.authorHeadline})` : ''}:`,
      post.text,
      `Write the ${tone} comment now. Reply with the comment text only.`
    ].join('\n')

    // No maxTokens cap: reasoning models (e.g. gemini-3.x) spend a reasoning phase BEFORE the
    // content, so a small cap starves the output → empty/truncated → judge rejects → 0 comments.
    // Bound length via the prompt ("under 280 characters"). Same family fix as Idea/Draft.
    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7
    })
    return completion.text.trim()
  }
}
