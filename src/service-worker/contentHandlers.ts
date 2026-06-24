// src/service-worker/contentHandlers.ts
// SW-side content/LLM orchestration, extracted from index.ts (SRP + ≤300).
// All deps are injected so each handler is unit-testable with fakes (the LLM
// boundary is crossed by a fake HttpClient returning real-shape responses).
import { createLlmProvider } from '@lib/llm/createLlmProvider'
import type { HttpClient, HttpGet } from '@lib/llm/contracts'
import type { LlmModel } from '@lib/llm/models'
import type { LlmProviderId } from '@lib/llm/contracts'

export type LlmHttp = HttpClient & HttpGet

/** List a provider's models for the settings dropdown (fallback list on failure). */
export async function listModels(
  http: LlmHttp,
  provider: LlmProviderId,
  apiKey: string
): Promise<LlmModel[]> {
  return createLlmProvider({ provider, apiKey }, http).listModels()
}
