import type { HttpClient } from '@lib/llm/contracts'

/**
 * Thin edge adapter: the only place the LLM layer touches the global `fetch`.
 * No unit tests (covered by integration / manual) — all logic lives in the
 * tested mappers and providers (DIP boundary).
 */
export class FetchHttpClient implements HttpClient {
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
}
