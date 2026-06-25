import type { FeedPost, TargetProfile } from '../types'
import { LikeFilter } from './LikeFilter'
import { RelevanceScorer } from './RelevanceScorer'

export interface CommentTargetOptions {
  /** Minimum relevance (0..1) — stricter than likes; comments are narrow + judged. */
  threshold: number
  /** Max posts to comment on this pass (anti-ban + quality over volume). */
  max: number
}

/**
 * Picks the NARROW set of posts worth a comment (design-spec §4.1: a like is broad
 * and reversible, a comment is narrow + judged). A candidate must (a) clear the same
 * broad junk filter as a like and (b) clear a STRICTER relevance threshold; the top
 * `max` by relevance are returned. Pure — composes LikeFilter + RelevanceScorer, so
 * the comment target set never reaches the page without passing this gate.
 */
export class CommentTargetSelector {
  private readonly likeFilter = new LikeFilter()
  private readonly scorer = new RelevanceScorer()

  select(posts: FeedPost[], profile: TargetProfile, opts: CommentTargetOptions): FeedPost[] {
    return posts
      .filter((post) => this.likeFilter.worthLiking(post).ok)
      .map((post) => ({ post, score: this.scorer.score(post, profile) }))
      .filter(({ score }) => score >= opts.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, opts.max))
      .map(({ post }) => post)
  }
}
