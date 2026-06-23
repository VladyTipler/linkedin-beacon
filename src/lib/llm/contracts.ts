// LLM layer contracts (ISP + DIP).
//
// Two providers ship in V1 (design-spec §10): OpenRouter (always) and the
// Google Gemini API directly (free-tier friendly for users who don't want to
// pay). They are interchangeable behind `LlmProvider` (LSP) and registered in
// a factory map (OCP — add a provider class, never edit a switch).

/** Supported provider backends. */
export type LlmProviderId = 'openrouter' | 'gemini'

/** Chat roles, normalised. Provider adapters map these to their own wire format. */
export type LlmRole = 'system' | 'user' | 'assistant'

export interface LlmMessage {
  role: LlmRole
  content: string
}

/** A provider-agnostic completion request. */
export interface LlmRequest {
  messages: LlmMessage[]
  /** Override the provider's configured default model. */
  model?: string
  temperature?: number
  maxTokens?: number
}

/** A provider-agnostic completion result. */
export interface LlmCompletion {
  text: string
  model: string
  provider: LlmProviderId
}

/** User-supplied configuration for a single provider. */
export interface LlmProviderConfig {
  provider: LlmProviderId
  apiKey: string
  /** Default model id; falls back to the provider's built-in default. */
  model?: string
}

/**
 * Narrow HTTP port (DIP). Providers depend on this, not on `fetch`, so they
 * are unit-testable with a fake. The only real implementation lives in a thin
 * edge adapter (`adapters/FetchHttpClient`).
 */
export interface HttpClient {
  postJson<TResponse>(
    url: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<TResponse>
}

/**
 * A substitutable LLM backend. Orchestrators depend on this interface only and
 * never type-check the concrete provider (LSP).
 */
export interface LlmProvider {
  readonly id: LlmProviderId
  complete(request: LlmRequest): Promise<LlmCompletion>
}

/** Raised when a provider response cannot be interpreted. */
export class LlmResponseError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProviderId
  ) {
    super(message)
    this.name = 'LlmResponseError'
  }
}
