import type { Clock, KeyValueStore, TabController } from '../ports'
import type { SsiSnapshot } from '../types'
import { RefreshPolicy } from './RefreshPolicy'
import { SnapshotRegistry } from './SnapshotRegistry'

export const LAST_REFRESH_KEY = 'ssi:lastRefreshAt'

export type RefreshResult =
  | { status: 'skipped' }
  | { status: 'refreshed'; snapshot: SsiSnapshot }
  | { status: 'timeout' }
  | { status: 'busy' }

export interface BackgroundRefreshDeps {
  policy: RefreshPolicy
  tabs: TabController
  registry: SnapshotRegistry
  store: KeyValueStore
  clock: Clock
  /** Injected so the timeout is deterministic in tests. */
  delay: (ms: number) => Promise<void>
  /** How long to wait for the worker tab to produce a snapshot. */
  timeoutMs: number
}

/**
 * Orchestrates background SSI refreshes via a disposable worker tab.
 *
 * SRP: lifecycle + timing only. It does NOT parse (content script does) and does
 * NOT persist snapshots (the SW's message handler saves every SSI_SNAPSHOT
 * regardless of origin). It only gates on the policy, drives the tab, and
 * records the last-success timestamp.
 *
 * Single-flight: a refresh in progress short-circuits concurrent calls so we
 * never spawn two worker windows at once.
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

    const { tabs, registry, store, clock, delay, timeoutMs } = this.deps
    let tabId: number | null = null
    try {
      tabId = await tabs.openSsiTab()
      const snapshot = await Promise.race([
        registry.waitFor(tabId),
        delay(timeoutMs).then<null>(() => null)
      ])

      if (snapshot) {
        await store.set(LAST_REFRESH_KEY, clock.now().toISOString())
        return { status: 'refreshed', snapshot }
      }
      return { status: 'timeout' }
    } finally {
      if (tabId !== null) {
        registry.cancel(tabId)
        await tabs.close(tabId).catch(() => {})
      }
      this.inFlight = false
    }
  }
}
