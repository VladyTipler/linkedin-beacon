import { describe, it, expect } from 'vitest'
import { QuarantineQueue } from './QuarantineQueue'
import type { KeyValueStore, AlarmScheduler } from '@lib/ports'
import type { ActionRequest } from '@lib/types'

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

function mutableClock(start: string) {
  let t = new Date(start).getTime()
  return { clock: { now: () => new Date(t) }, advanceMin: (min: number) => (t += min * 60_000) }
}

function fakeScheduler() {
  const scheduled: { name: string; whenMs: number }[] = []
  const cleared: string[] = []
  const scheduler: AlarmScheduler = {
    schedule: (name, whenMs) => scheduled.push({ name, whenMs }),
    clear: (name) => cleared.push(name)
  }
  return { scheduler, scheduled, cleared }
}

function counterIds() {
  let n = 0
  return () => `act-${++n}`
}

const comment: ActionRequest = {
  type: 'comment',
  target: { url: 'https://x/post/1' },
  payload: { comment: 'A specific expert reply.' }
}

const START = '2026-06-24T12:00:00.000Z'

describe('QuarantineQueue', () => {
  it('enqueues a quarantined item with a scheduledFor at the end of the window', async () => {
    const store = memStore()
    const { clock } = mutableClock(START)
    const { scheduler, scheduled } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })

    const item = await q.enqueue(comment, 10)

    expect(item.status).toBe('quarantined')
    expect(item.id).toBe('act-1')
    expect(item.scheduledFor).toBe('2026-06-24T12:10:00.000Z')
    expect(scheduled[0]).toEqual({ name: 'beacon:quarantine:act-1', whenMs: Date.parse('2026-06-24T12:10:00.000Z') })
  })

  it('does not report the item as due before the window elapses', async () => {
    const store = memStore()
    const { clock, advanceMin } = mutableClock(START)
    const { scheduler } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })

    await q.enqueue(comment, 10)
    advanceMin(9)
    expect(await q.due()).toEqual([])
  })

  it('reports the item as due once the window elapses', async () => {
    const store = memStore()
    const { clock, advanceMin } = mutableClock(START)
    const { scheduler } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })

    await q.enqueue(comment, 10)
    advanceMin(10)
    const due = await q.due()
    expect(due).toHaveLength(1)
    expect(due[0].id).toBe('act-1')
  })

  it('cancelling within the window skips the item and clears its alarm', async () => {
    const store = memStore()
    const { clock, advanceMin } = mutableClock(START)
    const { scheduler, cleared } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })

    const item = await q.enqueue(comment, 10)
    expect(await q.cancel(item.id)).toBe(true)
    advanceMin(20)
    expect(await q.due()).toEqual([])
    expect(cleared).toContain('beacon:quarantine:act-1')
  })

  it('returns false when cancelling an unknown id', async () => {
    const store = memStore()
    const { clock } = mutableClock(START)
    const { scheduler } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })
    expect(await q.cancel('nope')).toBe(false)
  })

  it('persists across a service-worker restart (new instance, same store)', async () => {
    const store = memStore()
    const { clock, advanceMin } = mutableClock(START)
    const { scheduler } = fakeScheduler()

    const q1 = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })
    await q1.enqueue(comment, 10)

    // SW evicted; a fresh instance rehydrates from the same store.
    const q2 = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })
    advanceMin(10)
    const due = await q2.due()
    expect(due).toHaveLength(1)
    expect(due[0].id).toBe('act-1')
  })

  it('tolerates a non-array value at the storage key (legacy/garbage)', async () => {
    const store = memStore()
    await store.set('engagement:quarantine', { corrupt: true })
    const { clock } = mutableClock(START)
    const { scheduler } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })
    expect(await q.list()).toEqual([])
    expect(await q.due()).toEqual([])
  })

  it('markSent removes the item from the due set', async () => {
    const store = memStore()
    const { clock, advanceMin } = mutableClock(START)
    const { scheduler } = fakeScheduler()
    const q = new QuarantineQueue({ store, clock, scheduler, newId: counterIds() })

    const item = await q.enqueue(comment, 10)
    advanceMin(10)
    await q.markSent(item.id)
    expect(await q.due()).toEqual([])
  })
})
