import { describe, it, expect } from 'vitest'
import { EngagementRunner } from './EngagementRunner'
import { EngagementOrchestrator, type ActionExecutor } from './EngagementOrchestrator'
import { RelevanceScorer } from './RelevanceScorer'
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
const noopScheduler: AlarmScheduler = { schedule: () => {}, clear: () => {} }

const posts: FeedPost[] = [
  { urn: 'A', authorName: 'Jane', authorHeadline: 'Recruiter', text: 'We use Vue', alreadyLiked: false },
  { urn: 'B', authorName: 'Bob', text: 'Vue tips', alreadyLiked: true },
  { urn: 'C', authorName: 'Cara', text: 'cooking pasta', alreadyLiked: false },
  { urn: 'D', authorName: 'Dan', text: 'TypeScript and Vue', alreadyLiked: false }
]

const settings: EngagementSettings = {
  config: {
    level: 'full_auto',
    guardrails: { minConfidence: 0.6, bannedPhrases: [], quarantineMinutes: 10, lenRange: [12, 280] },
    dailyLimits: { like: 60, comment: 10, connect: 0, post: 0 }
  },
  target: { stack: ['Vue'], targetRoles: ['recruiter'], geos: [], watchlistCompanies: [] },
  expertise: { headline: 'Frontend', stack: ['Vue'] },
  relevanceThreshold: 0.3
}

function build() {
  const store = memStore()
  const executed: ActionRequest[] = []
  const executor: ActionExecutor = { async execute(a) { executed.push(a) } }
  const orchestrator = new EngagementOrchestrator({
    gate: new ActionGate(),
    judge: new CommentJudge(),
    quarantine: new QuarantineQueue({ store, clock, scheduler: noopScheduler, newId: () => 'id' }),
    store,
    clock,
    executor,
    newId: () => 'id'
  })
  return { executed, orchestrator }
}

describe('EngagementRunner', () => {
  it('likes relevant, not-already-liked posts and tallies the pass', async () => {
    const { executed, orchestrator } = build()
    const runner = new EngagementRunner({
      harvest: async () => posts,
      scorer: new RelevanceScorer(),
      orchestrator
    })

    const summary = await runner.run(settings)

    expect(summary.scanned).toBe(4)
    expect(summary.relevant).toBe(2) // A and D (B is already liked, C is irrelevant)
    expect(summary.executed).toBe(2)
    expect(executed.map((a) => a.target.meta?.urn)).toEqual(['A', 'D'])
  })

  it('queues instead of executing in manual mode', async () => {
    const { executed, orchestrator } = build()
    const runner = new EngagementRunner({ harvest: async () => posts, scorer: new RelevanceScorer(), orchestrator })

    const summary = await runner.run({ ...settings, config: { ...settings.config, level: 'manual' } })

    expect(summary.relevant).toBe(2)
    expect(summary.queued).toBe(2)
    expect(summary.executed).toBe(0)
    expect(executed).toHaveLength(0)
  })
})
