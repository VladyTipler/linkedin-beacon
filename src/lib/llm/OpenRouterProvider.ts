import type { HttpClient, LlmCompletion, LlmProvider, LlmProviderConfig, LlmRequest } from './contracts'
import { toOpenRouterBody, fromOpenRouterResponse } from './mappers'

/**
 * OpenRouter backend (OpenAI-compatible). Depends only on the HttpClient port
 * (DIP) — no direct `fetch`, so it is fully unit-testable with a fake.
 */
export class OpenRouterProvider implements LlmProvider {
  readonly id = 'openrouter' as const
  readonly defaultModel: string
  private static readonly ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

  constructor(
    private readonly config: LlmProviderConfig,
    private readonly http: HttpClient
  ) {
    this.defaultModel = config.model ?? 'google/gemini-2.5-flash-lite'
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const body = toOpenRouterBody(request, this.defaultModel)
    const res = await this.http.postJson<unknown>(OpenRouterProvider.ENDPOINT, body, {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json'
    })
    return { text: fromOpenRouterResponse(res), model: body.model, provider: this.id }
  }
}
