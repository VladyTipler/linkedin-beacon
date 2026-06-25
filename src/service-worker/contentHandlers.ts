// src/service-worker/contentHandlers.ts
// SW-side content/LLM orchestration, extracted from index.ts (SRP + ≤300).
// All deps are injected so each handler is unit-testable with fakes (the LLM
// boundary is crossed by a fake HttpClient returning real-shape responses).
import { createLlmProvider } from '@lib/llm/createLlmProvider'
import { loadLlmConfig } from '@lib/llm/config'
import { loadContentSettings, languageName } from '@lib/content/settings'
import { DraftGenerator } from '@lib/content/DraftGenerator'
import { DraftStore } from '@lib/content/DraftStore'
import {
  isoWeekKey,
  rolloverPostWeek,
  recordPostWeek,
  remainingPosts,
  POST_WEEK_BUDGET_KEY,
  type PostWeek
} from '@lib/content/PostWeekBudget'
import { loadSettings } from '@lib/engagement/settings'
import { CommentDraftService } from '@lib/engagement/CommentDraftService'
import { CommentJudge } from '@lib/engagement/CommentJudge'
import { RelevanceScorer } from '@lib/engagement/RelevanceScorer'
import { enabledModules } from '@lib/autopilot/startGate'
import { IdeaExtractor } from '@lib/ideas/IdeaExtractor'
import { IdeaBank } from '@lib/ideas/IdeaBank'
import { feedPostToFeedItem } from '@lib/ideas/feedItem'
import { ideasPerDayLimit, rolloverIdeaDay, recordIdeaDay, remainingIdeas, IDEA_BUDGET_KEY, type IdeaDay } from '@lib/ideas/IdeaDayBudget'
import type { HttpClient, HttpGet, LlmProviderId } from '@lib/llm/contracts'
import type { LlmModel } from '@lib/llm/models'
import type { Clock, KeyValueStore } from '@lib/ports'
import type { Draft, FeedPost, Idea } from '@lib/types'

export type LlmHttp = HttpClient & HttpGet

/** List a provider's models for the settings dropdown (fallback list on failure). */
export async function listModels(
  http: LlmHttp,
  provider: LlmProviderId,
  apiKey: string
): Promise<LlmModel[]> {
  return createLlmProvider({ provider, apiKey }, http).listModels()
}

export interface DraftDeps {
  store: KeyValueStore
  http: LlmHttp
  clock: Clock
  newId: () => string
}

/** Idea + custom prompt → post draft (LLM) → store. Returns the new draft. */
export async function generateDraft(
  deps: DraftDeps,
  idea: Idea
): Promise<{ draft: Draft | null; error?: string }> {
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { draft: null, error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  const { postPrompt, contentLanguage } = await loadContentSettings(deps.store)
  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http
  )
  try {
    const text = await new DraftGenerator(provider).generate(
      idea,
      expertise,
      postPrompt,
      languageName(contentLanguage)
    )
    const draft: Draft = {
      id: deps.newId(),
      ideaTopic: idea.topic,
      ideaAngle: idea.angle,
      text,
      createdAt: deps.clock.now().toISOString()
    }
    await new DraftStore(deps.store).add(draft)
    return { draft }
  } catch (e) {
    return { draft: null, error: e instanceof Error ? e.message : 'llm_failed' }
  }
}

export interface IdeaDeps {
  store: KeyValueStore
  http: LlmHttp
  harvest: (limit: number) => Promise<FeedPost[]>
}

/** Harvest the feed → extract ideas (LLM) → bank them. Returns the full bank. */
export async function generateIdeas(deps: IdeaDeps): Promise<{ ideas: Idea[]; error?: string }> {
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { ideas: [], error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  if (!expertise.headline.trim()) return { ideas: [], error: 'no_expertise' }
  const posts = await deps.harvest(20)
  if (!posts.length) return { ideas: [], error: 'no_feed' }

  const provider = createLlmProvider({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model }, deps.http)
  const bank = new IdeaBank(deps.store)
  try {
    const ideas = await new IdeaExtractor(provider).extract(posts.map(feedPostToFeedItem), expertise)
    await bank.add(ideas)
    return { ideas: await bank.all() }
  } catch (e) {
    return { ideas: [], error: e instanceof Error ? e.message : 'llm_failed' }
  }
}

export interface RunIdeaDeps {
  store: KeyValueStore
  http: LlmHttp
  clock: Clock
}

/**
 * Extract ideas from a buffer the autopilot loop already harvested (no re-scroll),
 * capped by the day-keyed ideas/day budget. Crosses the real LLM mapper. Returns how
 * many NEW ideas were banked (dedup-aware) so a failed/duplicate extraction costs no budget.
 */
export async function extractRunIdeas(
  deps: RunIdeaDeps,
  posts: FeedPost[]
): Promise<{ stored: number; error?: string }> {
  if (!posts.length) return { stored: 0, error: 'no_feed' }
  const modulesState = await deps.store.get('modules:state')
  // SW self-guards (gatekeeper SSOT): never extract for a disabled content module,
  // even if a future caller or a manual message reaches this handler.
  if (!enabledModules(modulesState).some((m) => m.id === 'content')) return { stored: 0 }
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { stored: 0, error: 'no_key' }
  const { expertise } = await loadSettings(deps.store)
  if (!expertise.headline.trim()) return { stored: 0, error: 'no_expertise' }

  const limit = ideasPerDayLimit(modulesState)
  const today = deps.clock.now().toISOString().slice(0, 10)
  const budget = rolloverIdeaDay((await deps.store.get<IdeaDay>(IDEA_BUDGET_KEY)) ?? null, today)
  const allowance = remainingIdeas(budget, limit)
  if (allowance <= 0) return { stored: 0 }

  const provider = createLlmProvider({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model }, deps.http)
  const bank = new IdeaBank(deps.store)
  try {
    const before = (await bank.all()).length
    const ideas = await new IdeaExtractor(provider).extract(posts.map(feedPostToFeedItem), expertise)
    await bank.add(ideas.slice(0, allowance))
    const stored = (await bank.all()).length - before
    await deps.store.set(IDEA_BUDGET_KEY, recordIdeaDay(budget, stored))
    return { stored }
  } catch (e) {
    return { stored: 0, error: e instanceof Error ? e.message : 'llm_failed' }
  }
}

const COMMENT_BUDGET_KEY = 'comments:budget'
/** Comments are narrow + judged → a stricter relevance bar than the broad like filter. */
const COMMENT_THRESHOLD = 0.5
const COMMENT_GUARDRAILS = {
  minConfidence: 0,
  bannedPhrases: [],
  quarantineMinutes: 0,
  lenRange: [12, 280] as [number, number]
}

export interface CommentDeps {
  store: KeyValueStore
  http: LlmHttp
  clock: Clock
}

/**
 * Auto-comment on ONE relevant post during the run (Vlad's full-auto decision):
 * generate via CommentDraftService → quality-judge (slop never posts) → if ok, return
 * the text for the content script to executeComment. Gated by: comments enabled, BYOK
 * key, a STRICTER relevance threshold than likes, and the daily comment budget. Crosses
 * the real LLM mapper. "Full auto" = auto-post, but a failed judge is dropped, not posted.
 */
export async function commentOnPost(
  deps: CommentDeps,
  post: FeedPost
): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const settings = await loadContentSettings(deps.store)
  if (!settings.commentsEnabled) return { ok: false, reason: 'disabled' }
  const cfg = await loadLlmConfig(deps.store)
  if (!cfg.apiKey.trim()) return { ok: false, reason: 'no_key' }
  const { expertise, target } = await loadSettings(deps.store)
  if (!expertise.headline.trim()) return { ok: false, reason: 'no_expertise' }
  if (!new RelevanceScorer().isRelevant(post, target, COMMENT_THRESHOLD)) {
    return { ok: false, reason: 'not_relevant' }
  }
  const today = deps.clock.now().toISOString().slice(0, 10)
  const budget = rolloverIdeaDay((await deps.store.get<IdeaDay>(COMMENT_BUDGET_KEY)) ?? null, today)
  if (remainingIdeas(budget, settings.commentsPerDay) <= 0) return { ok: false, reason: 'budget' }

  const provider = createLlmProvider(
    { provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model },
    deps.http
  )
  try {
    const text = await new CommentDraftService(provider).draft({
      post,
      expertise,
      tone: settings.commentTone,
      language: languageName(settings.contentLanguage)
    })
    const verdict = new CommentJudge().judge(text, COMMENT_GUARDRAILS)
    if (!verdict.ok) return { ok: false, reason: verdict.reasons.join(',') || 'judged' }
    await deps.store.set(COMMENT_BUDGET_KEY, recordIdeaDay(budget, 1))
    return { ok: true, text }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'llm_failed' }
  }
}

export interface PublishDeps {
  store: KeyValueStore
  clock: Clock
  /** Sends the text to the content script's composer adapter; undefined if no tab. */
  publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined>
}

/**
 * Approve-first publish of ONE draft (Vlad clicked «Опубликовать»). Gated by the
 * weekly post cap (a safety limit on a manual action, NOT an autopilot budget). On a
 * successful DOM publish: consume the draft + record the week. A failed publish keeps
 * the draft and surfaces the reason. Posts are never full-auto / never in the run loop.
 */
export async function publishPost(
  deps: PublishDeps,
  draftId: string
): Promise<{ ok: boolean; reason?: string }> {
  const drafts = new DraftStore(deps.store)
  const draft = (await drafts.all()).find((d) => d.id === draftId)
  if (!draft) return { ok: false, reason: 'not_found' }

  const [{ postsPerWeek }, rawBudget] = await Promise.all([
    loadContentSettings(deps.store),
    deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY)
  ])
  const budget = rolloverPostWeek(rawBudget ?? null, isoWeekKey(deps.clock.now()))
  if (remainingPosts(budget, postsPerWeek) <= 0) return { ok: false, reason: 'budget' }

  const res = await deps.publish(draft.text)
  if (!res?.ok) return { ok: false, reason: res?.reason ?? 'publish_failed' }

  await drafts.remove(draftId)
  await deps.store.set(POST_WEEK_BUDGET_KEY, recordPostWeek(budget, 1))
  return { ok: true }
}
