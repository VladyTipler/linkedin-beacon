import { describe, it, expect, vi, afterEach } from 'vitest'
import { FetchHttpClient } from './FetchHttpClient'
import { HttpError } from '@lib/http/HttpError'

const respond = (status: number, body: string, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(body, { status, statusText: status === 429 ? 'Too Many Requests' : 'OK', headers }))

afterEach(() => vi.restoreAllMocks())

// Crosses the HTTP boundary: the retry layer relies on FetchHttpClient producing a
// typed HttpError with the status + server-advised delay from a REAL Gemini 429 body.
describe('FetchHttpClient error boundary', () => {
  const catchErr = async (fn: () => Promise<unknown>): Promise<HttpError> => {
    try {
      await fn()
    } catch (e) {
      if (e instanceof HttpError) return e
      throw e
    }
    throw new Error('expected a rejection')
  }

  it('throws HttpError(status, retryAfterMs) on a real Gemini free-tier 429', async () => {
    const body =
      '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-2.5-flash\\nPlease retry in 21.820828702s.","status":"RESOURCE_EXHAUSTED"}}'
    vi.stubGlobal('fetch', respond(429, body))

    const err = await catchErr(() => new FetchHttpClient().postJson('https://x', {}, {}))
    expect(err.status).toBe(429)
    expect(err.retryAfterMs).toBe(21821)
  })

  it('prefers a numeric Retry-After header when present (503)', async () => {
    vi.stubGlobal('fetch', respond(503, 'overloaded', { 'retry-after': '5' }))
    const err = await catchErr(() => new FetchHttpClient().getJson('https://x', {}))
    expect(err.status).toBe(503)
    expect(err.retryAfterMs).toBe(5000)
  })

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', respond(200, '{"ok":true}'))
    expect(await new FetchHttpClient().postJson('https://x', {}, {})).toEqual({ ok: true })
  })
})
