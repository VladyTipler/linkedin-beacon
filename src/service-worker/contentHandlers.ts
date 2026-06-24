// src/service-worker/contentHandlers.ts
// SW-side content/LLM orchestration, extracted from index.ts (SRP + ≤300).
// All deps are injected so each handler is unit-testable with fakes (the LLM
// boundary is crossed by a fake HttpClient returning real-shape responses).
import { createLlmProvider } from '@lib/llm/createLlmProvider'
import { loadLlmConfig } from '@lib/llm/config'
import { loadContentSettings } from '@lib/content/settings'
import { DraftGenerator } from '@lib/content/DraftGenerator'
import { DraftStore } from '@lib/content/DraftStore'
import { loadSettings } from '@lib/engagement/settings'
import { IdeaExtractor } from '@lib/ideas/IdeaExtractor'
import { IdeaBank } from '@lib/ideas/IdeaBank'
import { feedPostToFeedItem } from '@lib/ideas/feedItem'
import type { HttpClient, HttpGet, LlmProviderId } from '@lib/llm/contracts'
import type { LlmModel } from '@lib/llm/models'
import type { Clock, KeyValueStore } from '@lib/ports'
import type { Draft, FeedPost, Idea } from '@lib/types'

export type LlmHttp = HttpClient & HttpGet

/** List a provider's models for the settings dropdown (fallback list on failure). */
export async function listModels(
  http: LlmHttp,
  provider: LlmProviderId,
  apiKey: string
): Promise<LlmModel[]> {
  return createLlmProvider({ provider, apiKey }, http).listModels()
}

export interface DraftDeps {
  store: KeyValueStore
  http: LlmHttp
  clock: Clock
  newId: () => string
}

/** Idea + custom prompt → post draft (LLM) → store. Returns the new draft. */
export async function generateDraft(
  deps: DraftDeps,
  idea: Idea
): Promise<{ draft: Draft | null; error?: string }> {
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { draft: null, error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  const { postPrompt } = await loadContentSettings(deps.store)
  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http
  )
  try {
    const text = await new DraftGenerator(provider).generate(idea, expertise, postPrompt)
    const draft: Draft = {
      id: deps.newId(),
      ideaTopic: idea.topic,
      ideaAngle: idea.angle,
      text,
      createdAt: deps.clock.now().toISOString()
    }
    await new DraftStore(deps.store).add(draft)
    return { draft }
  } catch (e) {
    return { draft: null, error: e instanceof Error ? e.message : 'llm_failed' }
  }
}

export interface IdeaDeps {
  store: KeyValueStore
  http: LlmHttp
  harvest: (limit: number) => Promise<FeedPost[]>
}

/** Harvest the feed → extract ideas (LLM) → bank them. Returns the full bank. */
export async function generateIdeas(deps: IdeaDeps): Promise<{ ideas: Idea[]; error?: string }> {
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { ideas: [], error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  if (!expertise.headline.trim()) return { ideas: [], error: 'no_expertise' }
  const posts = await deps.harvest(20)
  if (!posts.length) return { ideas: [], error: 'no_feed' }

  const provider = createLlmProvider({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model }, deps.http)
  const bank = new IdeaBank(deps.store)
  try {
    const ideas = await new IdeaExtractor(provider).extract(posts.map(feedPostToFeedItem), expertise)
    await bank.add(ideas)
    return { ideas: await bank.all() }
  } catch (e) {
    return { ideas: [], error: e instanceof Error ? e.message : 'llm_failed' }
  }
}
