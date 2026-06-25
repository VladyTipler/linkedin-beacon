import type { LlmProvider } from '../llm/contracts'
import type { ExpertiseProfile, FeedItem, Idea, IdeaSpark } from '../types'

/**
 * Turns harvested feed posts into a bank of content ideas (design-spec §4.3.1).
 *
 * The critical anti-slop rule: the feed is a SIGNAL of what topics resonate, not
 * a set of examples to imitate. Echoing posts produces generic AI-slop that kills
 * the "brand" pillar. So the prompt forbids copying and crosses each topic with
 * the user's expertise to yield an original angle. Behind LlmProvider → fake-tested.
 */
export class IdeaExtractor {
  constructor(private readonly provider: LlmProvider) {}

  async extract(posts: FeedItem[], expertise: ExpertiseProfile): Promise<Idea[]> {
    const system = [
      'You surface CONTENT IDEAS for the user to post on LinkedIn.',
      `The user is: ${expertise.headline}. Stack: ${expertise.stack.join(', ')}.`,
      'The feed posts below are a SIGNAL of which topics resonate now — NOT examples to imitate.',
      'Do not copy, summarise or paraphrase the posts. Echoing the feed is AI-slop and is forbidden.',
      "Cross each resonant topic with the user's own expertise to produce an original angle.",
      'Ground EACH idea in ONE specific post. Return ONLY a JSON array of',
      '[{"topic": string, "angle": string, "sourceIndex": number, "claim": string, "quote": string}].',
      'sourceIndex = the 1-based number of the post that sparked it. claim = its point/tension worth a take.',
      'quote = a short (<140 char) snippet from that post.',
      'CRITICAL: your ENTIRE reply must be the raw JSON array — it MUST start with "[" and end',
      'with "]". No prose, no explanation, no markdown, no code fences before or after.'
    ].join(' ')

    const user = [
      'Feed posts (signal only):',
      ...posts.map((p, i) => `${i + 1}. ${p.excerpt}`),
      'Reply with ONLY the JSON array of 3–6 ideas. Start your reply with "[".'
    ].join('\n')

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.4,
      maxTokens: 600
    })
    return parseIdeas(completion.text, posts)
  }
}

interface RawIdea {
  topic: unknown
  angle: unknown
  sourceIndex?: unknown
  claim?: unknown
  quote?: unknown
}

/** Tolerantly parse ideas, grounding each in its source post (spark). Handles ``` fences. */
export function parseIdeas(raw: string, posts: FeedItem[]): Idea[] {
  const json = extractJsonArray(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('ideas_not_json')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('ideas_not_json')
  }
  return parsed
    .filter(
      (e): e is RawIdea =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as RawIdea).topic === 'string' &&
        ((e as RawIdea).topic as string).length > 0 &&
        typeof (e as RawIdea).angle === 'string' &&
        ((e as RawIdea).angle as string).length > 0
    )
    .map((e) => {
      const idea: Idea = { topic: e.topic as string, angle: e.angle as string }
      if (typeof e.claim === 'string' && e.claim.length > 0) {
        const quote = typeof e.quote === 'string' ? e.quote : ''
        const i = typeof e.sourceIndex === 'number' ? e.sourceIndex - 1 : -1
        const spark: IdeaSpark =
          i >= 0 && i < posts.length
            ? { claim: e.claim, quote, source: { author: posts[i].author, id: posts[i].id } }
            : { claim: e.claim, quote }
        idea.spark = spark
      }
      return idea
    })
}

function extractJsonArray(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : raw).trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('ideas_not_json')
  }
  return body.slice(start, end + 1)
}
