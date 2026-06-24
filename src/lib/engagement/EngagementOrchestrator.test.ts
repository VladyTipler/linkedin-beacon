import { describe, it, expect } from 'vitest'
import {
  EngagementOrchestrator,
  type ActionExecutor,
  type EngagementConfig
} from './EngagementOrchestrator'
import { ActionGate } from '../gate/ActionGate'
import { CommentJudge } from './CommentJudge'
import { QuarantineQueue } from '../gate/QuarantineQueue'
import type { KeyValueStore, AlarmScheduler } from '../ports'
import type { ActionRequest, Guardrails } from '../types'

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
const noopScheduler: AlarmScheduler = { schedule: () => {}, clear: () => {} }

function recordingExecutor() {
  const executed: ActionRequest[] = []
  const executor: ActionExecutor = {
    async execute(a) {
      executed.push(a)
    }
  }
  return { executor, executed }
}

function counterIds() {
  let n = 0
  return () => `q-${++n}`
}

const guardrails: Guardrails = {
  minConfidence: 0.6,
  bannedPhrases: ['great post'],
  quarantineMinutes: 10,
  lenRange: [12, 280]
}
const limits = { like: 2, comment: 2, connect: 0, post: 0 }

const like: ActionRequest = { type: 'like', target: { url: 'p/1' } }
const comment = (text: string): ActionRequest => ({
  type: 'comment',
  target: { url: 'p/1' },
  payload: { comment: text }
})

function build(start = '2026-06-24T12:00:00.000Z') {
  const store = memStore()
  const { clock, advanceMin } = mutableClock(start)
  const { executor, executed } = recordingExecutor()
  const orch = new EngagementOrchestrator({
    gate: new ActionGate(),
    judge: new CommentJudge(),
    quarantine: new QuarantineQueue({ store, clock, scheduler: noopScheduler, newId: counterIds() }),
    store,
    clock,
    executor,
    newId: counterIds()
  })
  return { orch, executed, advanceMin, store }
}

const cfg = (level: EngagementConfig['level']): EngagementConfig => ({
  level,
  guardrails,
  dailyLimits: limits
})

describe('EngagementOrchestrator', () => {
  it('queues for approval in manual mode and executes only on approve', async () => {
    const { orch, executed } = build()
    const out = await orch.submit(like, cfg('manual'))
    expect(out.status).toBe('queued')
    expect(executed).toHaveLength(0)

    const approved = await orch.approve((out as { id: string }).id)
    expect(approved.status).toBe('executed')
    expect(executed).toHaveLength(1)
    expect(executed[0]).toMatchObject(like)
  })

  it('rejects a queued action: drops it without executing', async () => {
    const { orch, executed } = build()
    const out = await orch.submit(like, cfg('manual'))
    expect((await orch.pending()).map((i) => i.id)).toContain((out as { id: string }).id)

    expect(await orch.reject((out as { id: string }).id)).toBe(true)
    expect(await orch.pending()).toEqual([])
    expect(executed).toHaveLength(0)
    expect(await orch.reject('nope')).toBe(false)
  })

  it('executes immediately in full_auto and spends the budget', async () => {
    const { orch, executed } = build()
    expect((await orch.submit(like, cfg('full_auto'))).status).toBe('executed')
    expect((await orch.submit(like, cfg('full_auto'))).status).toBe('executed')
    // limit is 2 → third is skipped
    expect((await orch.submit(like, cfg('full_auto'))).status).toBe('skipped')
    expect(executed).toHaveLength(2)
  })

  it('blocks a guardrails comment that fails the judge', async () => {
    const { orch, executed } = build()
    const out = await orch.submit(comment('great post!!'), cfg('auto_guardrails'))
    expect(out.status).toBe('blocked')
    expect(executed).toHaveLength(0)
  })

  it('quarantines a judged-ok guardrails comment, releasing it after the window', async () => {
    const { orch, executed, advanceMin } = build()
    const out = await orch.submit(
      comment('Solid point on SSR hydration, we hit that too.'),
      cfg('auto_guardrails')
    )
    expect(out.status).toBe('quarantined')
    expect(executed).toHaveLength(0)

    advanceMin(5)
    expect(await orch.releaseDue()).toBe(0) // window not elapsed
    expect(executed).toHaveLength(0)

    advanceMin(5)
    expect(await orch.releaseDue()).toBe(1)
    expect(executed).toHaveLength(1)
  })

  it('tolerates a non-array pending queue in storage', async () => {
    const { orch, store } = build()
    await store.set('engagement:pending', { corrupt: true })
    expect(await orch.pending()).toEqual([])
    // a fresh manual submit still works on top of the garbage
    const out = await orch.submit(like, cfg('manual'))
    expect(out.status).toBe('queued')
  })

  it('keeps separate daily budgets per action type', async () => {
    const { orch, executed } = build()
    await orch.submit(like, cfg('full_auto'))
    await orch.submit(like, cfg('full_auto')) // likes now exhausted (limit 2)
    expect((await orch.submit(like, cfg('full_auto'))).status).toBe('skipped')
    // comments have their own budget, still available
    const c = await orch.submit(comment('A genuinely useful, on-topic remark.'), cfg('full_auto'))
    expect(c.status).toBe('executed')
    expect(executed).toHaveLength(3)
  })
})
