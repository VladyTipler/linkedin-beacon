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
import type { HttpClient, HttpGet } from '@lib/llm/contracts'
import type { LlmModel } from '@lib/llm/models'
import type { LlmProviderId } from '@lib/llm/contracts'
import type { Clock, KeyValueStore } from '@lib/ports'
import type { Draft, Idea } from '@lib/types'

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
