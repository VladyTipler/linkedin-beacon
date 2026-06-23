import type { ActionRequest, EngagementRunSummary, FeedPost } from '../types'
import type { RelevanceScorer } from './RelevanceScorer'
import type { EngagementOrchestrator, SubmitOutcome } from './EngagementOrchestrator'
import type { EngagementSettings } from './settings'

export interface EngagementRunnerDeps {
  /** Harvest up to `limit` feed posts (content-script DOM read). */
  harvest: (limit: number) => Promise<FeedPost[]>
  scorer: RelevanceScorer
  orchestrator: EngagementOrchestrator
}

const HARVEST_LIMIT = 20

/**
 * One engagement pass (design-spec §4.1): harvest the feed, keep posts that are
 * relevant and not already liked, and route a like through the orchestrator for
 * each. Pure orchestration over injected deps → fully fake-tested. The gate
 * decides what actually happens (queue/quarantine/execute) per automationLevel.
 */
export class EngagementRunner {
  constructor(private readonly deps: EngagementRunnerDeps) {}

  async run(settings: EngagementSettings): Promise<EngagementRunSummary> {
    const posts = await this.deps.harvest(HARVEST_LIMIT)
    const summary: EngagementRunSummary = {
      scanned: posts.length,
      relevant: 0,
      executed: 0,
      queued: 0,
      quarantined: 0,
      skipped: 0,
      blocked: 0
    }

    for (const post of posts) {
      if (post.alreadyLiked) continue
      if (!this.deps.scorer.isRelevant(post, settings.target, settings.relevanceThreshold)) continue
      summary.relevant++
      const action: ActionRequest = {
        type: 'like',
        target: {
          url: 'https://www.linkedin.com/feed/',
          meta: { urn: post.urn, author: post.authorName }
        }
      }
      const outcome = await this.deps.orchestrator.submit(action, settings.config)
      tally(summary, outcome)
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
  }
}
