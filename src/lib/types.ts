// ── Domain model. Mirrors design-spec §3 (SSI), §4 (modules), §6 (inbox). ──

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

export type ModuleId = 'engagement' | 'smart_connect' | 'content' | 'auto_apply'

export interface ModuleState {
  id: ModuleId
  enabled: boolean
  automationLevel: AutomationLevel
  /** Whether the module is shipped or "coming soon" in the current build. */
  available: boolean
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
  payload?: { note?: string; comment?: string }
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

/**
 * A content idea: a topic the feed shows is resonating, crossed with the user's
 * own angle (design-spec §4.3.1). NOT a copy of any post — that would be AI-slop.
 */
export interface Idea {
  topic: string
  angle: string
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
  /** sidepanel → SW: run one engagement pass (harvest → score → gate likes). */
  | { type: 'RUN_ENGAGEMENT' }
  /** SW → sidepanel: outcome of an engagement run (broadcast). */
  | { type: 'ENGAGEMENT_RESULT'; summary: EngagementRunSummary }
  /** sidepanel → SW: list quarantined actions; SW replies ActionQueueItem[] via sendResponse. */
  | { type: 'LIST_QUARANTINE' }
  /** sidepanel → SW: cancel a quarantined action within its window. */
  | { type: 'CANCEL_QUARANTINE'; id: string }
  /** sidepanel → SW: refresh SSI in the background if the policy says it's due. */
  | { type: 'REQUEST_REFRESH' }
  /** sidepanel → SW: force a background SSI refresh now (manual refresh button). */
  | { type: 'FORCE_REFRESH' }
  | { type: 'PING' }
  | { type: 'PONG' }

/** Compile-time exhaustiveness guard for message switches. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled message variant: ${JSON.stringify(x)}`)
}
