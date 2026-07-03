import type { HttpClient } from '@lib/llm/contracts'
import type { JsonHttpGet } from '@lib/ssi-api/contracts'
import type { HttpPostText } from '@lib/profileViews/contracts'
import { HttpError, parseRetryAfterMs } from '@lib/http/HttpError'

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
export class FetchHttpClient implements HttpClient, JsonHttpGet, HttpPostText {
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
    if (!res.ok) await this.fail(res)
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
    if (!res.ok) await this.fail(res)
    return (await res.json()) as TResponse
  }

  /**
   * Authenticated POST returning the raw text body — for LinkedIn's SDUI
   * server-request (WVMP), whose response is an RSC flight payload, not JSON.
   * `credentials: 'include'` attaches the session cookies (host_permissions).
   */
  async postText(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      credentials: 'include'
    })
    if (!res.ok) await this.fail(res)
    return res.text()
  }

  /**
   * Throw a typed HttpError carrying the status + any server-advised retry delay
   * (Retry-After header or a "retry in Xs" hint in the body). Reads the FULL body
   * for the delay, but keeps the human message short.
   */
  private async fail(res: Response): Promise<never> {
    const detail = await res.text().catch(() => '')
    throw new HttpError(
      res.status,
      `HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 300)}`,
      parseRetryAfterMs(res.headers.get('retry-after'), detail)
    )
  }
}
