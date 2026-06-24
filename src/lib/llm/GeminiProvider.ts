import type { HttpClient, HttpGet, LlmCompletion, LlmProvider, LlmProviderConfig, LlmRequest } from './contracts'
import { toGeminiBody, fromGeminiResponse } from './mappers'
import { FALLBACK_MODELS, parseGeminiModels, type LlmModel } from './models'

/**
 * Google Gemini API backend (direct). Auth goes in the query string (Google
 * convention), never in headers. Depends only on the HTTP ports (DIP).
 */
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const
  readonly defaultModel: string
  private static readonly BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

  constructor(
    private readonly config: LlmProviderConfig,
    private readonly http: HttpClient & HttpGet
  ) {
    this.defaultModel = config.model ?? 'gemini-2.5-flash'
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const model = request.model ?? this.defaultModel
    const url = `${GeminiProvider.BASE}/${model}:generateContent?key=${encodeURIComponent(this.config.apiKey)}`
    const body = toGeminiBody(request)
    const res = await this.http.postJson<unknown>(url, body, { 'Content-Type': 'application/json' })
    return { text: fromGeminiResponse(res), model, provider: this.id }
  }

  async listModels(): Promise<LlmModel[]> {
    try {
      const url = `${GeminiProvider.BASE}?key=${encodeURIComponent(this.config.apiKey)}`
      const raw = await this.http.getJson<unknown>(url, {})
      const models = parseGeminiModels(raw)
      return models.length ? models : FALLBACK_MODELS.gemini
    } catch {
      return FALLBACK_MODELS.gemini
    }
  }
}
