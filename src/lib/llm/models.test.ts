import { describe, it, expect } from 'vitest'
import { OpenRouterProvider } from './OpenRouterProvider'
import { GeminiProvider } from './GeminiProvider'
import { FALLBACK_MODELS, parseOpenRouterModels, parseGeminiModels } from './models'
import type { HttpClient, HttpGet } from './contracts'

/** Fake implementing both ports; getJson can be told to throw. */
class FakeHttp implements HttpClient, HttpGet {
  lastGetUrl = ''
  constructor(private readonly getResponse: unknown, private readonly fail = false) {}
  async postJson<T>(): Promise<T> { return {} as T }
  async getJson<T>(url: string): Promise<T> {
    this.lastGetUrl = url
    if (this.fail) throw new Error('network')
    return this.getResponse as T
  }
}

const OPENROUTER_RAW = {
  data: [
    { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
    { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash' }
  ]
}

const GEMINI_RAW = {
  models: [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/embedding-001', displayName: 'Embedding 001', supportedGenerationMethods: ['embedContent'] }
  ]
}

describe('parseOpenRouterModels', () => {
  it('maps data[].id/name to LlmModel', () => {
    expect(parseOpenRouterModels(OPENROUTER_RAW)).toEqual([
      { id: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' },
      { id: 'google/gemini-2.5-flash', label: 'Google: Gemini 2.5 Flash' }
    ])
  })
})

describe('parseGeminiModels', () => {
  it('keeps only generateContent models and strips the models/ prefix', () => {
    expect(parseGeminiModels(GEMINI_RAW)).toEqual([
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }
    ])
  })
})

describe('OpenRouterProvider.listModels', () => {
  it('GETs the models endpoint and parses the list', async () => {
    const http = new FakeHttp(OPENROUTER_RAW)
    const provider = new OpenRouterProvider({ provider: 'openrouter', apiKey: 'sk' }, http)
    const models = await provider.listModels()
    expect(http.lastGetUrl).toBe('https://openrouter.ai/api/v1/models')
    expect(models[0]).toEqual({ id: 'openai/gpt-4o', label: 'OpenAI: GPT-4o' })
  })

  it('falls back to the curated list on fetch failure', async () => {
    const http = new FakeHttp(null, true)
    const provider = new OpenRouterProvider({ provider: 'openrouter', apiKey: 'sk' }, http)
    expect(await provider.listModels()).toEqual(FALLBACK_MODELS.openrouter)
  })
})

describe('GeminiProvider.listModels', () => {
  it('GETs the models endpoint with the key in the query string', async () => {
    const http = new FakeHttp(GEMINI_RAW)
    const provider = new GeminiProvider({ provider: 'gemini', apiKey: 'AIza-1' }, http)
    const models = await provider.listModels()
    expect(http.lastGetUrl).toContain('https://generativelanguage.googleapis.com/v1beta/models')
    expect(http.lastGetUrl).toContain('key=AIza-1')
    expect(models).toEqual([{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }])
  })

  it('falls back to the curated list on fetch failure', async () => {
    const http = new FakeHttp(null, true)
    const provider = new GeminiProvider({ provider: 'gemini', apiKey: 'AIza-1' }, http)
    expect(await provider.listModels()).toEqual(FALLBACK_MODELS.gemini)
  })
})
