import type { SsiSnapshot } from '../types'

/**
 * Correlates a background tab with the snapshot its content script will emit.
 *
 * The service worker opens a worker tab, then awaits `waitFor(tabId)`. When the
 * content script in that tab posts an SSI_SNAPSHOT, the SW calls
 * `deliver(tabId, snapshot)` and the pending promise resolves.
 *
 * Pure (no timers): the caller owns the timeout via Promise.race, which keeps
 * this class deterministic to test. A short-lived buffer guards the race where
 * `deliver` lands a hair before `waitFor` is registered.
 */
export class SnapshotRegistry {
  private readonly waiters = new Map<number, (s: SsiSnapshot) => void>()
  private readonly buffered = new Map<number, SsiSnapshot>()

  /** Resolves with the next snapshot delivered for `tabId`. */
  waitFor(tabId: number): Promise<SsiSnapshot> {
    const pending = this.buffered.get(tabId)
    if (pending) {
      this.buffered.delete(tabId)
      return Promise.resolve(pending)
    }
    return new Promise<SsiSnapshot>((resolve) => {
      this.waiters.set(tabId, resolve)
    })
  }

  /** Hand a freshly parsed snapshot to whoever is waiting on `tabId`. */
  deliver(tabId: number, snapshot: SsiSnapshot): void {
    const waiter = this.waiters.get(tabId)
    if (waiter) {
      this.waiters.delete(tabId)
      waiter(snapshot)
    } else {
      this.buffered.set(tabId, snapshot)
    }
  }

  /** Drop any pending waiter/buffer for `tabId` (call on timeout or cleanup). */
  cancel(tabId: number): void {
    this.waiters.delete(tabId)
    this.buffered.delete(tabId)
  }
}
