import type { HttpClient } from '@lib/llm/contracts'
import type { JsonHttpGet } from '@lib/ssi-api/contracts'

/**
 * Thin edge adapter: the only place we touch the global `fetch`. No unit tests
 * (covered by integration / manual) — all logic lives in tested mappers,
 * providers and the SSI client behind their DIP boundaries.
 *
 * Implements both the LLM POST port and the SSI GET port. `getJson` uses
 * `credentials: 'include'` so the browser attaches the user's LinkedIn session
 * cookies (li_at etc., which are HttpOnly and unreadable from JS) — this is
 * what lets us call `/sales-api/*` authenticated, with host_permissions granted.
 */
export class FetchHttpClient implements HttpClient, JsonHttpGet {
  async postJson<TResponse>(
    url: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<TResponse> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`)
    }
    return (await res.json()) as TResponse
  }

  async getJson<TResponse>(
    url: string,
    headers: Record<string, string>
  ): Promise<TResponse> {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include'
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`)
    }
    return (await res.json()) as TResponse
  }
}
