import { describe, it, expect, beforeEach } from 'vitest'
import {
  BackgroundRefreshService,
  LAST_REFRESH_KEY
} from './BackgroundRefreshService'
import { RefreshPolicy } from './RefreshPolicy'
import { SnapshotRegistry } from './SnapshotRegistry'
import type { Clock, KeyValueStore, TabController } from '../ports'
import type { SsiSnapshot } from '../types'

class FakeStore implements KeyValueStore {
  private data = new Map<string, unknown>()
  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }
}

class FakeTabController implements TabController {
  opened = 0
  closed: number[] = []
  async openSsiTab(): Promise<number> {
    this.opened += 1
    return 1
  }
  async close(tabId: number): Promise<void> {
    this.closed.push(tabId)
  }
}

const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) })
const snap = (total: number): SsiSnapshot => ({
  total,
  pillars: [],
  capturedAt: '2026-06-23T12:00:00.000Z'
})

const NOW = '2026-06-23T12:00:00.000Z'

describe('BackgroundRefreshService', () => {
  let store: FakeStore
  let tabs: FakeTabController
  let registry: SnapshotRegistry

  beforeEach(() => {
    store = new FakeStore()
    tabs = new FakeTabController()
    registry = new SnapshotRegistry()
  })

  const build = (delay: (ms: number) => Promise<void>) =>
    new BackgroundRefreshService({
      policy: new RefreshPolicy(24 * 60 * 60 * 1000),
      tabs,
      registry,
      store,
      clock: fixedClock(NOW),
      delay,
      timeoutMs: 1000
    })

  it('skips (no tab opened) when a refresh is not due', async () => {
    await store.set(LAST_REFRESH_KEY, NOW) // just refreshed
    const svc = build(() => Promise.resolve())
    const result = await svc.refreshIfDue()
    expect(result.status).toBe('skipped')
    expect(tabs.opened).toBe(0)
  })

  it('opens a worker tab when due, persists timestamp, and closes the tab', async () => {
    const svc = build(() => new Promise<void>(() => {})) // never times out
    const run = svc.refreshNow()
    // Content script "parses" and the SW would deliver into the registry:
    await Promise.resolve()
    registry.deliver(1, snap(73))

    const result = await run
    expect(result).toEqual({ status: 'refreshed', snapshot: snap(73) })
    expect(tabs.opened).toBe(1)
    expect(tabs.closed).toEqual([1])
    expect(await store.get<string>(LAST_REFRESH_KEY)).toBe(NOW)
  })

  it('times out without recording success, but still closes the tab', async () => {
    const svc = build(() => Promise.resolve()) // timeout fires immediately
    const result = await svc.refreshNow()
    expect(result.status).toBe('timeout')
    expect(tabs.closed).toEqual([1])
    expect(await store.get<string>(LAST_REFRESH_KEY)).toBeNull()
  })

  it('is single-flight: a concurrent refresh returns busy', async () => {
    const svc = build(() => new Promise<void>(() => {}))
    const first = svc.refreshNow()
    const second = await svc.refreshNow()
    expect(second.status).toBe('busy')
    expect(tabs.opened).toBe(1)

    registry.deliver(1, snap(50))
    await first
  })
})
