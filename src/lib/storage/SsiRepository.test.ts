import { describe, it, expect, beforeEach } from 'vitest'
import { SsiRepository } from './SsiRepository'
import type { KeyValueStore } from '../ports'
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

function snap(total: number, at: string): SsiSnapshot {
  return {
    total,
    pillars: [],
    capturedAt: at
  }
}

describe('SsiRepository', () => {
  let store: FakeStore
  let repo: SsiRepository

  beforeEach(() => {
    store = new FakeStore()
    repo = new SsiRepository(store, 3)
  })

  it('returns null latest when empty', async () => {
    expect(await repo.latest()).toBeNull()
    expect(await repo.history()).toEqual([])
  })

  it('saves and reads back the latest snapshot', async () => {
    const s = snap(71, '2026-06-23T10:00:00.000Z')
    await repo.save(s)
    expect(await repo.latest()).toEqual(s)
    expect(await repo.history()).toHaveLength(1)
  })

  it('latest reflects the most recent save', async () => {
    await repo.save(snap(60, '2026-06-21T10:00:00.000Z'))
    await repo.save(snap(71, '2026-06-23T10:00:00.000Z'))
    expect((await repo.latest())?.total).toBe(71)
  })

  it('caps history at the configured limit, keeping newest', async () => {
    await repo.save(snap(1, 'a'))
    await repo.save(snap(2, 'b'))
    await repo.save(snap(3, 'c'))
    await repo.save(snap(4, 'd'))
    const history = await repo.history()
    expect(history).toHaveLength(3)
    expect(history.map((h) => h.total)).toEqual([2, 3, 4])
  })
})
