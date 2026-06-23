import type { Clock, KeyValueStore } from '../ports'
import type { SsiApiClient } from '../ssi-api/contracts'
import type { SsiSnapshot } from '../types'
import { RefreshPolicy } from './RefreshPolicy'

export const LAST_REFRESH_KEY = 'ssi:lastRefreshAt'

export type RefreshResult =
  | { status: 'skipped' }
  | { status: 'refreshed'; snapshot: SsiSnapshot }
  | { status: 'error'; error: string }
  | { status: 'busy' }

export interface BackgroundRefreshDeps {
  policy: RefreshPolicy
  apiClient: SsiApiClient
  store: KeyValueStore
  clock: Clock
}

/**
 * Orchestrates background SSI refreshes via the internal LinkedIn API.
 *
 * SRP: policy gating + single-flight + timestamp bookkeeping. It does NOT
 * fetch (the API client does), does NOT interpret JSON (the mapper does), and
 * does NOT persist the snapshot (the SW saves the returned snapshot via the
 * repository). It only decides *whether/when* to refresh and stamps capture time.
 *
 * The API path runs entirely in the service worker — no tab, no window, no
 * visible flash, works from any page (or with no LinkedIn tab open at all).
 */
export class BackgroundRefreshService {
  private inFlight = false

  constructor(private readonly deps: BackgroundRefreshDeps) {}

  /** Refresh only if the policy says enough time has passed. */
  async refreshIfDue(): Promise<RefreshResult> {
    const last = await this.deps.store.get<string>(LAST_REFRESH_KEY)
    if (!this.deps.policy.isDue(last, this.deps.clock.now())) {
      return { status: 'skipped' }
    }
    return this.refreshNow()
  }

  /** Force a refresh regardless of timing (e.g. the panel's refresh button). */
  async refreshNow(): Promise<RefreshResult> {
    if (this.inFlight) return { status: 'busy' }
    this.inFlight = true

    const { apiClient, store, clock } = this.deps
    try {
      const raw = await apiClient.fetchSnapshot()
      const capturedAt = clock.now().toISOString()
      const snapshot: SsiSnapshot = { ...raw, capturedAt }
      await store.set(LAST_REFRESH_KEY, capturedAt)
      return { status: 'refreshed', snapshot }
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) }
    } finally {
      this.inFlight = false
    }
  }
}
