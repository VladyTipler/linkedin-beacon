import { describe, it, expect } from 'vitest'
import { RunReportStore } from './RunReportStore'
import type { KeyValueStore } from '@lib/ports'
import type { RunReport } from '@lib/types'

function memStore(): KeyValueStore {
  const m = new Map<string, unknown>()
  return {
    async get<T>(k: string) {
      return m.has(k) ? (m.get(k) as T) : null
    },
    async set<T>(k: string, v: T) {
      m.set(k, v)
    }
  }
}

const report = (id: string): RunReport => ({
  id,
  startedAt: '2026-06-24T10:00:00.000Z',
  endedAt: '2026-06-24T10:30:00.000Z',
  host: 'window',
  stopReason: 'budget',
  modules: [{ id: 'engagement', executed: 30, skipped: 5, failed: 1 }]
})

describe('RunReportStore', () => {
  it('lists newest first', async () => {
    const s = new RunReportStore(memStore())
    await s.add(report('a'))
    await s.add(report('b'))
    expect((await s.list()).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('caps the history', async () => {
    const s = new RunReportStore(memStore(), 2)
    await s.add(report('a'))
    await s.add(report('b'))
    await s.add(report('c'))
    expect((await s.list()).map((r) => r.id)).toEqual(['c', 'b'])
  })

  it('persists across instances sharing a store', async () => {
    const store = memStore()
    await new RunReportStore(store).add(report('a'))
    expect((await new RunReportStore(store).list()).map((r) => r.id)).toEqual(['a'])
  })

  it('tolerates a non-array stored value', async () => {
    const store = memStore()
    await store.set('autopilot:reports', { corrupt: true })
    expect(await new RunReportStore(store).list()).toEqual([])
  })
})
