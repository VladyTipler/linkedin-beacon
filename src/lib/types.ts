// ── Domain model. Mirrors design-spec §3 (SSI), §4 (modules), §6 (inbox). ──

import type { RiskMarker } from './autopilot/RiskAssessor'
import type { LlmProviderId } from './llm/contracts'

/** The four SSI pillars LinkedIn reports on /sales/ssi (each scored 0..25). */
export type SsiPillarKey = 'brand' | 'people' | 'insights' | 'relationships'

export interface SsiPillar {
  key: SsiPillarKey
  /** Localised display label, e.g. "Профессиональный бренд". */
  label: string
  /** 0..25 */
  score: number
}

export interface SsiSnapshot {
  /** 0..100, sum of the four pillars. */
  total: number
  pillars: SsiPillar[]
  /** Industry rank text as shown by LinkedIn, e.g. "Top 4%". */
  industryRank?: string
  /** Network rank text, e.g. "Top 1%". */
  networkRank?: string
  /** ISO timestamp of when this snapshot was captured. */
  capturedAt: string
}

/** Per-module automation trust level (design-spec §5.5). */
export type AutomationLevel = 'manual' | 'auto_guardrails' | 'full_auto'

/** Quality guardrails for auto_guardrails mode (design-spec §5.5). */
export interface Guardrails {
  /** Judge confidence threshold 0..1 below which an action is blocked. */
  minConfidence: number
  /** Phrases that must not appear (case-insensitive). */
  bannedPhrases: string[]
  /** Cancel-window length before a quarantined action sends; 0 = full-auto. */
  quarantineMinutes: number
  /** Allowed [min, max] character length for generated text. */
  lenRange: [number, number]
}

export type ModuleId = 'engagement' | 'smart_connect' | 'content' | 'profile_views'

export interface ModuleState {
  id: ModuleId
  enabled: boolean
  automationLevel: AutomationLevel
  /** Whether the module is shipped or "coming soon" in the current build. */
  available: boolean
  /** Per-module budget: likes/day (engagement), connects/week, posts/week. */
  dailyLimit: number
}

// ── Action model (design-spec §9) — what the gate routes and the queue persists. ──

export type ActionType = 'like' | 'comment' | 'connect' | 'post'

export interface ActionTarget {
  /** Canonical URL of the post/profile the action targets. */
  url: string
  /** Free-form context (urn, author, …). */
  meta?: Record<string, unknown>
}

export interface ActionRequest {
  type: ActionType
  target: ActionTarget
  payload?: { note?: string; comment?: string; post?: string }
}

/** A connectable person harvested from a LinkedIn people-search result card. */
export interface PersonCandidate {
  /** Stable LinkedIn member id (from the connect anchor's componentkey). Dedup key. */
  memberId: string
  name: string
  /** The professional sub-headline (shown for transparency in the run report). */
  headline: string
  profileUrl: string
}

/**
 * Why a people-search harvest produced what it did — lets the run distinguish
 * "rendered, genuinely 0 results" (`empty`) from "page never rendered in time"
 * (`not_ready`). Without this the SW only sees an empty array and can't tell a
 * dead search from a slow/failed navigation (see run-report reasons).
 */
export type HarvestOutcome = 'ok' | 'empty' | 'not_ready'

export interface HarvestResult {
  candidates: PersonCandidate[]
  outcome: HarvestOutcome
}

export type ActionStatus =
  | 'pending' // awaiting manual approval
  | 'quarantined' // approved, sends after the cancel window unless cancelled
  | 'approved' // ready to execute now
  | 'done'
  | 'skipped'
  | 'blocked'

export interface ActionQueueItem extends ActionRequest {
  id: string
  status: ActionStatus
  /** ISO time the action should send (quarantine window end), if scheduled. */
  scheduledFor?: string
  createdAt: string
}

export type AutopilotHost = 'tab' | 'window'
export type StopReason = 'budget' | 'risk' | 'manual' | 'feed_exhausted'

/** Reply to START_AUTOPILOT: did the run start, and if not, why (UI surfaces a hint). */
export interface StartAutopilotResult {
  started: boolean
  reason?: 'no-modules'
}

/** What one module did in a run: how many actions it executed and WHY (machine code). */
export interface ModuleOutcome {
  executed: number
  /** Machine reason code (done | disabled | no_keywords | empty_search | not_ready | …). */
  reason: string
}

/** A persisted record of one autopilot run (design-spec §2.3 reports). */
export interface RunReport {
  id: string
  startedAt: string
  endedAt: string
  host: AutopilotHost
  stopReason: StopReason
  /** `reason` is the per-module outcome code (older reports may lack it). */
  modules: { id: ModuleId; executed: number; skipped: number; failed: number; reason?: string }[]
}

/** SW-owned persisted autopilot state. */
export interface AutopilotState {
  running: boolean
  host: AutopilotHost
  windowId?: number
  tabId?: number
  /** UTC day key (YYYY-MM-DD) the ceiling/used belong to — makes the budget daily. */
  day: string
  ceiling: number
  used: number
  actionTimestamps: number[]
  actionsSinceBreak: number
  manualStop: boolean
  startedAt: string
  /**
   * Per-module outcome (executed + reason) recorded as each pre-loop step runs, so the
   * final run report can name WHY every module did what it did — never a silent 0.
   * Engagement's executed is reconciled from `used` at stop time.
   */
  moduleOutcomes?: Partial<Record<ModuleId, ModuleOutcome>>
}

export interface AutopilotStatus {
  running: boolean
  used: number
  ceiling: number
  stopReason?: StopReason
}

/** Tally of one engagement pass (design-spec §4.1 metrics). */
export interface EngagementRunSummary {
  scanned: number
  relevant: number
  executed: number
  queued: number
  quarantined: number
  skipped: number
  blocked: number
  failed: number
}

export interface InboundLead {
  id: string
  name: string
  role: string
  /** 'messaged' = wrote to you; 'viewed' = viewed your profile. */
  signal: 'messaged' | 'viewed'
  /** e.g. "3×" for repeat views. */
  count?: number
}

/** A post harvested from the feed (engagement module, manual read-only in V1). */
export interface FeedItem {
  id: string
  author: string
  /** Trimmed text content of the post. */
  excerpt: string
}

/**
 * A richer feed post used for engagement scoring/actions (design-spec §4.1).
 * Carries the signals relevance scoring needs that a bare FeedItem omits.
 */
export interface FeedPost {
  /** Stable LinkedIn activity urn — dedup key across feed virtualisation scroll. */
  urn: string
  authorName: string
  /** Author headline, e.g. "Technical Recruiter at Acme" — the role signal. */
  authorHeadline?: string
  /** Post body text. */
  text: string
  /** Whether the current user already reacted (read from the DOM) — like dedup. */
  alreadyLiked?: boolean
}

/** The user's own expertise, used to author comments/posts in their voice (§4.3.1, §10). */
export interface ExpertiseProfile {
  /** Short professional headline, e.g. "Frontend TechLead, 11y Vue/TS". */
  headline: string
  /** Tech stack the user can speak to with authority. */
  stack: string[]
  /** Optional longer bio / context for few-shot voice. */
  bio?: string
}

/** Comment tone preset (design-spec §4.1). */
export type CommentTone = 'expert' | 'friendly' | 'question'

export interface IdeaSpark {
  /** The specific point/tension in the source post worth a take. */
  claim: string
  /** A short snippet from the source as evidence (may be empty). */
  quote: string
  /** Provenance: which feed post sparked it (absent if the model gave a bad index). */
  source?: { author: string; id: string }
}

/**
 * A content idea: a topic the feed shows is resonating, crossed with the user's
 * own angle (design-spec §4.3.1). NOT a copy of any post — that would be AI-slop.
 */
export interface Idea {
  topic: string
  angle: string
  /** Optional grounding in a real resonating post — the anti-slop anchor. */
  spark?: IdeaSpark
}

/** A generated post draft (design-spec §4.3). Not published until Layer 2. */
export interface Draft {
  id: string
  ideaTopic: string
  ideaAngle: string
  /** The full generated post body. */
  text: string
  /** ISO timestamp. */
  createdAt: string
  /** Human approved this draft for auto-publish (undefined = not approved). */
  approved?: boolean
}

/**
 * Diagnostic of the most recent in-loop idea extraction, surfaced on the Content tab so
 * a silently-skipped or failed auto-collect is no longer invisible (was: "генерирую…" → 0).
 */
export interface IdeasLastRun {
  at: string
  reason: 'ok' | 'no_feed' | 'thin_feed' | 'disabled' | 'no_key' | 'no_expertise' | 'budget_exhausted' | 'error'
  stored: number
  /** Buffered posts seen this run (set on thin_feed so the UI can show how close it was). */
  posts?: number
  budget?: { used: number; limit: number }
  error?: string
}

/** Targeting criteria: who/what to engage with (design-spec §4.1, §9 TargetProfile). */
export interface TargetProfile {
  /** Tech stack keywords, e.g. ['Vue','TypeScript']. */
  stack: string[]
  /** Target author roles, e.g. ['recruiter','talent']. */
  targetRoles: string[]
  /** Geos of interest, e.g. ['remote','Berlin']. */
  geos: string[]
  /** Companies on the watchlist. */
  watchlistCompanies: string[]
}

// ── Typed messaging between content script ↔ service worker ↔ sidepanel ──
// Discriminated union — every handler switches on `type` exhaustively.

export type BeaconMessage =
  /** sidepanel/SW → content: parse the current page for SSI. */
  | { type: 'REQUEST_SSI' }
  /** content → SW → sidepanel: a fresh snapshot was parsed. */
  | { type: 'SSI_SNAPSHOT'; payload: SsiSnapshot }
  /** content → SW: page is not an SSI page / parse failed. */
  | { type: 'SSI_PARSE_FAILED'; reason: string }
  /** sidepanel → content: harvest feed posts (read-only). */
  | { type: 'REQUEST_FEED_HARVEST'; limit: number }
  /** content → sidepanel: harvested feed items. */
  | { type: 'FEED_ITEMS'; payload: FeedItem[] }
  /** SW → content: harvest rich feed posts; content replies FeedPost[] via sendResponse. */
  | { type: 'REQUEST_FEED_POSTS'; limit: number }
  /** SW → content: perform a gated action in the DOM; content replies ActionResult. */
  | { type: 'EXECUTE_ACTION'; action: ActionRequest }
  /** SW → content: toggle the "agent is working" pulsing border overlay (+ status label). */
  | { type: 'SET_ACTIVITY'; active: boolean; label?: string }
  /** sidepanel → SW: list quarantined actions; SW replies ActionQueueItem[] via sendResponse. */
  | { type: 'LIST_QUARANTINE' }
  /** sidepanel → SW: cancel a quarantined action within its window. */
  | { type: 'CANCEL_QUARANTINE'; id: string }
  /** sidepanel → SW: refresh SSI in the background if the policy says it's due. */
  | { type: 'REQUEST_REFRESH' }
  /** sidepanel → SW: force a background SSI refresh now (manual refresh button). */
  | { type: 'FORCE_REFRESH' }
  /** sidepanel → SW: start the autonomous loop in the chosen host. */
  | { type: 'START_AUTOPILOT'; host: AutopilotHost }
  /** sidepanel → SW / SW → content: stop the autonomous loop. */
  | { type: 'STOP_AUTOPILOT' }
  /** content → SW: may I perform this action? SW replies a GateDecision via sendResponse. */
  | { type: 'AUTOPILOT_MAY_ACT'; actionType: ActionType }
  /** content → SW: an action was attempted (ok = it landed). */
  | { type: 'AUTOPILOT_ACTED'; ok: boolean }
  /** content → SW: a risk marker was seen on the page. */
  | { type: 'AUTOPILOT_RISK'; marker: RiskMarker }
  /** content → SW: the loop concluded locally; finalize the run with this reason. */
  | { type: 'AUTOPILOT_ENDED'; reason: StopReason }
  /** SW → content: begin the harvest→act loop; flags say which modules to drive. */
  | { type: 'AUTOPILOT_RUN_LOOP'; modules: { engagement: boolean; content: boolean; comments: boolean } }
  /** content → SW: extract ideas from the run buffer; replies { stored, error? }. */
  | { type: 'EXTRACT_RUN_IDEAS'; posts: FeedPost[] }
  /** content → SW: auto-comment on a relevant post; replies { ok, text?, reason? }. */
  | { type: 'COMMENT_ON_POST'; post: FeedPost }
  /** SW → sidepanel: live autopilot status (broadcast). */
  | { type: 'AUTOPILOT_STATUS'; status: AutopilotStatus }
  /** SW → sidepanel: the run's CURRENT step label (broadcast) — "Добавляю в сеть…" etc. */
  | { type: 'AUTOPILOT_STAGE'; label: string }
  /** SW → sidepanel: a run finished and was recorded (broadcast). */
  | { type: 'AUTOPILOT_REPORT'; report: RunReport }
  /** sidepanel → SW: list run reports; SW replies RunReport[] via sendResponse. */
  | { type: 'LIST_REPORTS' }
  /** sidepanel → SW: list models for a provider+key; SW replies LlmModel[]. */
  | { type: 'LIST_MODELS'; provider: LlmProviderId; apiKey: string }
  /** sidepanel → SW: idea + prompt → post draft; replies { draft, error? }. */
  | { type: 'GENERATE_DRAFT'; idea: Idea }
  /** sidepanel → SW: harvest feed → extract ideas → bank; replies { ideas, error? }. */
  | { type: 'GENERATE_IDEAS' }
  /**
   * SW → content: harvest ONLY the currently-loaded people-search page (no pagination) —
   * connect must run per-page (a candidate's Connect anchor is only in the DOM on its page).
   * Replies HarvestResult.
   */
  | { type: 'HARVEST_PEOPLE_PAGE' }
  /**
   * SW → content: harvest the current people-search page for Profile Views — ALL people
   * regardless of connect status (incl. already-invited "Pending"), not just connectable.
   * Replies HarvestResult.
   */
  | { type: 'HARVEST_PROFILES_PAGE' }
  /** SW → content: advance the people-search to the next page; replies boolean (false = none). */
  | { type: 'PEOPLE_NEXT_PAGE' }
  /** SW → content: human-dwell on the current (already-navigated) profile; replies ActionResult. */
  | { type: 'DWELL_PROFILE' }
  /**
   * SW → content: sleep `ms` then reply. The SW `await`s the reply to stay alive — a long
   * setTimeout IN the SW gets the worker evicted mid-pause (kills the connect/views loop).
   */
  | { type: 'SLEEP'; ms: number }
  | { type: 'PING' }
  | { type: 'PONG' }

/** Compile-time exhaustiveness guard for message switches. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled message variant: ${JSON.stringify(x)}`)
}
