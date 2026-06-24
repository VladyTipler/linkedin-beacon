import { describe, it, expect } from 'vitest'
import { EngagementRunner } from './EngagementRunner'
import { EngagementOrchestrator, type ActionExecutor } from './EngagementOrchestrator'
import { LikeFilter } from './LikeFilter'
import { ActionGate } from '../gate/ActionGate'
import { CommentJudge } from './CommentJudge'
import { QuarantineQueue } from '../gate/QuarantineQueue'
import type { KeyValueStore, AlarmScheduler } from '../ports'
import type { ActionRequest, FeedPost } from '../types'
import type { EngagementSettings } from './settings'

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
const clock = { now: () => new Date('2026-06-24T12:00:00.000Z') }
const noop: AlarmScheduler = { schedule: () => {}, clear: () => {} }

const posts: FeedPost[] = [
  { urn: 'A', authorName: 'Jane', text: 'shipping a Vue component today', alreadyLiked: false },
  { urn: 'B', authorName: 'Bob', text: 'random weekend cooking thoughts', alreadyLiked: false },
  { urn: 'C', authorName: 'Ann', text: 'giveaway! use code FREE', alreadyLiked: false },
  { urn: 'D', authorName: 'Dan', text: 'already liked this one', alreadyLiked: true }
]

const settings: EngagementSettings = {
  config: {
    level: 'full_auto',
    guardrails: { minConfidence: 0.6, bannedPhrases: [], quarantineMinutes: 10, lenRange: [12, 280] },
    dailyLimits: { like: 60, comment: 10, connect: 0, post: 0 }
  },
  target: { stack: ['Vue'], targetRoles: [], geos: [], watchlistCompanies: [] },
  expertise: { headline: 'Frontend', stack: ['Vue'] },
  relevanceThreshold: 0.3
}

function orchestratorWith(executor: ActionExecutor) {
  const store = memStore()
  return new EngagementOrchestrator({
    gate: new ActionGate(),
    judge: new CommentJudge(),
    quarantine: new QuarantineQueue({ store, clock, scheduler: noop, newId: () => 'id' }),
    store,
    clock,
    executor,
    newId: () => 'id'
  })
}

describe('EngagementRunner (broad likes)', () => {
  it('likes all non-junk posts (A,B), skips promo (C) and already-liked (D)', async () => {
    const executed: ActionRequest[] = []
    const runner = new EngagementRunner({
      harvest: async () => posts,
      likeFilter: new LikeFilter(),
      orchestrator: orchestratorWith({ async execute(a) { executed.push(a) } })
    })
    const summary = await runner.run(settings)
    expect(summary.scanned).toBe(4)
    expect(summary.relevant).toBe(2) // likeable candidates A,B
    expect(summary.executed).toBe(2)
    expect(summary.skipped).toBe(2) // C promo, D already_liked
    expect(executed.map((a) => a.target.meta?.urn)).toEqual(['A', 'B']) // Vue post first
  })

  it('counts a failing action as failed and keeps going', async () => {
    let n = 0
    const runner = new EngagementRunner({
      harvest: async () => posts,
      likeFilter: new LikeFilter(),
      orchestrator: orchestratorWith({ async execute() { if (n++ === 0) throw new Error('boom') } })
    })
    const summary = await runner.run(settings)
    expect(summary.failed).toBe(1)
    expect(summary.executed).toBe(1)
  })

  it('paces after each real like (anti-ban)', async () => {
    let paced = 0
    const runner = new EngagementRunner({
      harvest: async () => posts,
      likeFilter: new LikeFilter(),
      orchestrator: orchestratorWith({ async execute() {} }),
      pace: async () => {
        paced++
      }
    })
    await runner.run(settings)
    expect(paced).toBe(2) // A and B executed
  })
})
