import type { LlmProvider } from '../llm/contracts'
import type { ExpertiseProfile, FeedItem, Idea } from '../types'

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
      'Return ONLY a JSON array: [{"topic": string, "angle": string}]. No prose.'
    ].join(' ')

    const user = [
      'Feed posts (signal only):',
      ...posts.map((p, i) => `${i + 1}. ${p.excerpt}`),
      'Produce 3–6 ideas as the JSON array.'
    ].join('\n')

    const completion = await this.provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.8,
      maxTokens: 500
    })
    return parseIdeas(completion.text)
  }
}

/** Tolerantly parse an ideas JSON array from a model response (handles ``` fences). */
export function parseIdeas(raw: string): Idea[] {
  const json = extractJsonArray(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('IdeaExtractor: model response was not valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('IdeaExtractor: expected a JSON array of ideas')
  }
  return parsed
    .filter(
      (e): e is Idea =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Idea).topic === 'string' &&
        (e as Idea).topic.length > 0 &&
        typeof (e as Idea).angle === 'string' &&
        (e as Idea).angle.length > 0
    )
    .map((e) => ({ topic: e.topic, angle: e.angle }))
}

function extractJsonArray(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced ? fenced[1] : raw).trim()
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('IdeaExtractor: no JSON array found in response')
  }
  return body.slice(start, end + 1)
}
