/**
 * HTTP error carrying the status code and, when the server advises one, a retry
 * delay. Lets the retry layer decide precisely (by status, not message-matching)
 * whether a failure is transient and how long to wait. Extends Error, so existing
 * callers that only read `.message` are unaffected.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/**
 * Server-advised retry delay in ms, from a numeric `Retry-After` header (seconds)
 * or a delay hint in the body — e.g. Gemini's free-tier 429 says
 * "Please retry in 21.82s" / `"retryDelay": "7s"`. Returns undefined if none.
 * Note: this reads the FULL body (the hint often sits past the truncated message).
 */
export function parseRetryAfterMs(header: string | null, body: string): number | undefined {
  if (header) {
    const secs = Number(header.trim())
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000)
  }
  const m = body.match(/retry(?:\s+in|delay["':\s]+)\s*"?([\d.]+)s/i)
  if (m) {
    const v = parseFloat(m[1])
    if (Number.isFinite(v)) return Math.ceil(v * 1000)
  }
  return undefined
}
