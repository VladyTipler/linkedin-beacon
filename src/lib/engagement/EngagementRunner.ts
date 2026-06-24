import type { ActionRequest, EngagementRunSummary, FeedPost } from '../types'
import type { LikeFilter } from './LikeFilter'
import type { EngagementOrchestrator, SubmitOutcome } from './EngagementOrchestrator'
import type { EngagementSettings } from './settings'

export interface EngagementRunnerDeps {
  harvest: (limit: number) => Promise<FeedPost[]>
  likeFilter: LikeFilter
  orchestrator: EngagementOrchestrator
  /** Anti-ban pause after each action that hit the page. No-op in tests. */
  pace?: () => Promise<void>
}

const HARVEST_TARGET = 25

/**
 * One autonomous engagement pass (design-spec §4.1): harvest the feed, keep every
 * non-junk post (broad — a like is cheap/reversible), and route a like through the
 * orchestrator for each, paced. Stack only orders candidates (LikeFilter), it never
 * gates. Pure orchestration over injected deps → fake-tested.
 */
export class EngagementRunner {
  constructor(private readonly deps: EngagementRunnerDeps) {}

  async run(settings: EngagementSettings): Promise<EngagementRunSummary> {
    const posts = await this.deps.harvest(HARVEST_TARGET)
    const { likeable, skipped } = this.deps.likeFilter.select(posts, settings.target)

    const summary: EngagementRunSummary = {
      scanned: posts.length,
      relevant: likeable.length,
      executed: 0,
      queued: 0,
      quarantined: 0,
      skipped: skipped.length,
      blocked: 0,
      failed: 0
    }

    for (const post of likeable) {
      const action: ActionRequest = {
        type: 'like',
        target: {
          url: 'https://www.linkedin.com/feed/',
          meta: { urn: post.urn, author: post.authorName }
        }
      }
      const outcome = await this.deps.orchestrator.submit(action, settings.config)
      tally(summary, outcome)
      if (outcome.status === 'executed' || outcome.status === 'quarantined') {
        await this.deps.pace?.()
      }
    }
    return summary
  }
}

function tally(summary: EngagementRunSummary, outcome: SubmitOutcome): void {
  switch (outcome.status) {
    case 'executed':
      summary.executed++
      break
    case 'queued':
      summary.queued++
      break
    case 'quarantined':
      summary.quarantined++
      break
    case 'skipped':
      summary.skipped++
      break
    case 'blocked':
      summary.blocked++
      break
    case 'failed':
      summary.failed++
      break
  }
}
