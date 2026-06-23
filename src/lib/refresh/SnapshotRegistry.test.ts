import { describe, it, expect } from 'vitest'
import { SnapshotRegistry } from './SnapshotRegistry'
import type { SsiSnapshot } from '../types'

const snap = (total: number): SsiSnapshot => ({
  total,
  pillars: [],
  capturedAt: '2026-06-23T12:00:00.000Z'
})

describe('SnapshotRegistry', () => {
  it('resolves a pending waiter when a snapshot is delivered', async () => {
    const reg = new SnapshotRegistry()
    const promise = reg.waitFor(7)
    reg.deliver(7, snap(42))
    expect((await promise).total).toBe(42)
  })

  it('buffers a snapshot delivered before waitFor is registered (race-safe)', async () => {
    const reg = new SnapshotRegistry()
    reg.deliver(7, snap(99))
    expect((await reg.waitFor(7)).total).toBe(99)
  })

  it('routes snapshots to the correct tab', async () => {
    const reg = new SnapshotRegistry()
    const a = reg.waitFor(1)
    const b = reg.waitFor(2)
    reg.deliver(2, snap(20))
    reg.deliver(1, snap(10))
    expect((await a).total).toBe(10)
    expect((await b).total).toBe(20)
  })

  it('clears the buffer on cancel so a stale snapshot is not delivered', async () => {
    const reg = new SnapshotRegistry()
    reg.deliver(7, snap(1))
    reg.cancel(7)
    // After cancel the buffer is empty: waitFor must now pend, not resolve stale.
    let resolved = false
    void reg.waitFor(7).then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
  })
})
