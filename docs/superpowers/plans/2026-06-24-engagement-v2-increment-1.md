# Engagement v2 — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Run campaign" an autonomous, paced pass that auto-scrolls the LinkedIn feed, harvests a batch, likes broadly (junk filtered, no LLM), and returns a reliable summary.

**Architecture:** Pure core units (`FeedAccumulator`, `ScrollHarvestPolicy`, `LikeFilter`) are added in `src/lib`. The content script gains a scroll-harvest loop behind `REQUEST_FEED_POSTS`. `EngagementRunner` switches from per-post relevance gating to broad filtering. The orchestrator contains per-action failures. The SW replies to `RUN_ENGAGEMENT` with the summary via `sendResponse` and best-effort re-injects the content script.

**Tech Stack:** Vue 3 + TypeScript + Vite + @crxjs/vite-plugin, Vitest, Chrome MV3 (sidePanel, scripting, alarms, tabs, cookies).

## Global Constraints

- Core (`src/lib/**`) imports no `chrome`/`document`/`fetch`; randomness/time via the `Rng`/`Clock` ports. One line: pure core, thin edge.
- Files ≤ 300 lines; one responsibility per file (SOLID).
- TDD: failing test first, watch it fail, minimal code, watch it pass, commit. Tests on fakes.
- `npx vitest run` AND `npm run build` (vue-tsc + vite) must be green before any task is "done".
- Commit per task. Work on `main` (user's choice). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Existing domain types live in `src/lib/types.ts`; reuse `FeedPost`, `TargetProfile`, `RelevanceScorer`, `ActionGate`, `EngagementOrchestrator`, `EngagementRunner`, `HumanDelay`.

---

## File Structure

- Create `src/lib/feed/FeedAccumulator.ts` (+ `.test.ts`) — dedup posts across scroll rounds.
- Create `src/lib/feed/ScrollHarvestPolicy.ts` (+ `.test.ts`) — when to stop scrolling.
- Create `src/lib/engagement/LikeFilter.ts` (+ `.test.ts`) — broad "worth a like?" filter + relevance ordering.
- Modify `src/lib/types.ts` — add `failed` to `EngagementRunSummary`; add `'failed'` to `SubmitOutcome` (in orchestrator file).
- Modify `src/lib/engagement/EngagementOrchestrator.ts` (+ `.test.ts`) — contain executor failures as `{status:'failed'}`.
- Modify `src/lib/engagement/EngagementRunner.ts` (+ `.test.ts`) — broad filter instead of relevance gate; tally `failed`.
- Modify `src/content/index.ts` — scroll-harvest loop behind `REQUEST_FEED_POSTS`.
- Modify `src/service-worker/index.ts` — `RUN_ENGAGEMENT` replies summary via `sendResponse`; content re-inject fallback.
- Modify `src/sidepanel/composables/useEngagement.ts` — get summary via `panelBus.request`.

---

### Task 1: FeedAccumulator (dedup across scroll rounds)

**Files:**
- Create: `src/lib/feed/FeedAccumulator.ts`
- Test: `src/lib/feed/FeedAccumulator.test.ts`

**Interfaces:**
- Consumes: `FeedPost` from `@lib/types`.
- Produces: `class FeedAccumulator { add(posts: FeedPost[]): number; size(): number; items(): FeedPost[] }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/feed/FeedAccumulator.test.ts
import { describe, it, expect } from 'vitest'
import { FeedAccumulator } from './FeedAccumulator'
import type { FeedPost } from '@lib/types'

const post = (urn: string, text = 'x'): FeedPost => ({ urn, authorName: 'a', text })

describe('FeedAccumulator', () => {
  it('adds new posts and returns the count newly added', () => {
    const acc = new FeedAccumulator()
    expect(acc.add([post('1'), post('2')])).toBe(2)
    expect(acc.size()).toBe(2)
  })

  it('dedups by urn across rounds, counting only the new ones', () => {
    const acc = new FeedAccumulator()
    acc.add([post('1'), post('2')])
    expect(acc.add([post('2'), post('3')])).toBe(1) // only '3' is new
    expect(acc.items().map((p) => p.urn)).toEqual(['1', '2', '3'])
  })

  it('preserves first-seen order and content', () => {
    const acc = new FeedAccumulator()
    acc.add([post('1', 'first')])
    acc.add([post('1', 'changed')]) // ignored — already seen
    expect(acc.items()[0].text).toBe('first')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/feed/FeedAccumulator.test.ts`
Expected: FAIL — cannot resolve `./FeedAccumulator`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/feed/FeedAccumulator.ts
import type { FeedPost } from '../types'

/** Collects feed posts across scroll rounds, deduped by urn, first-seen order. */
export class FeedAccumulator {
  private readonly seen = new Set<string>()
  private readonly list: FeedPost[] = []

  /** Add a round of posts; returns how many were newly added (not seen before). */
  add(posts: FeedPost[]): number {
    let added = 0
    for (const post of posts) {
      if (this.seen.has(post.urn)) continue
      this.seen.add(post.urn)
      this.list.push(post)
      added++
    }
    return added
  }

  size(): number {
    return this.list.length
  }

  items(): FeedPost[] {
    return [...this.list]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/feed/FeedAccumulator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/FeedAccumulator.ts src/lib/feed/FeedAccumulator.test.ts
git commit -m "feat(feed): FeedAccumulator — dedup posts across scroll rounds"
```

---

### Task 2: ScrollHarvestPolicy (when to stop scrolling)

**Files:**
- Create: `src/lib/feed/ScrollHarvestPolicy.ts`
- Test: `src/lib/feed/ScrollHarvestPolicy.test.ts`

**Interfaces:**
- Produces: `interface ScrollState { collected: number; target: number; staleRounds: number; round: number }` and `class ScrollHarvestPolicy { constructor(cfg?: { maxStaleRounds?: number; maxRounds?: number }); shouldStop(s: ScrollState): boolean }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/feed/ScrollHarvestPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { ScrollHarvestPolicy, type ScrollState } from './ScrollHarvestPolicy'

const s = (over: Partial<ScrollState>): ScrollState => ({
  collected: 0,
  target: 25,
  staleRounds: 0,
  round: 0,
  ...over
})

describe('ScrollHarvestPolicy', () => {
  const policy = new ScrollHarvestPolicy({ maxStaleRounds: 2, maxRounds: 15 })

  it('stops once the target count is reached', () => {
    expect(policy.shouldStop(s({ collected: 25 }))).toBe(true)
    expect(policy.shouldStop(s({ collected: 24 }))).toBe(false)
  })

  it('stops after too many stale rounds (feed exhausted)', () => {
    expect(policy.shouldStop(s({ collected: 5, staleRounds: 2 }))).toBe(true)
    expect(policy.shouldStop(s({ collected: 5, staleRounds: 1 }))).toBe(false)
  })

  it('stops at the hard round cap', () => {
    expect(policy.shouldStop(s({ collected: 5, round: 15 }))).toBe(true)
    expect(policy.shouldStop(s({ collected: 5, round: 14 }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/feed/ScrollHarvestPolicy.test.ts`
Expected: FAIL — cannot resolve `./ScrollHarvestPolicy`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/feed/ScrollHarvestPolicy.ts
export interface ScrollState {
  collected: number
  target: number
  staleRounds: number
  round: number
}

/** Decides when to stop the scroll-harvest loop. Pure — no DOM, no timers. */
export class ScrollHarvestPolicy {
  private readonly maxStaleRounds: number
  private readonly maxRounds: number

  constructor(cfg: { maxStaleRounds?: number; maxRounds?: number } = {}) {
    this.maxStaleRounds = cfg.maxStaleRounds ?? 2
    this.maxRounds = cfg.maxRounds ?? 15
  }

  shouldStop(s: ScrollState): boolean {
    return s.collected >= s.target || s.staleRounds >= this.maxStaleRounds || s.round >= this.maxRounds
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/feed/ScrollHarvestPolicy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/feed/ScrollHarvestPolicy.ts src/lib/feed/ScrollHarvestPolicy.test.ts
git commit -m "feat(feed): ScrollHarvestPolicy — stop on target/stale/cap"
```

---

### Task 3: LikeFilter (broad junk filter + relevance ordering)

**Files:**
- Create: `src/lib/engagement/LikeFilter.ts`
- Test: `src/lib/engagement/LikeFilter.test.ts`

**Interfaces:**
- Consumes: `FeedPost`, `TargetProfile` from `@lib/types`; `RelevanceScorer` from `./RelevanceScorer`.
- Produces: `class LikeFilter { worthLiking(post: FeedPost): { ok: boolean; reason?: string }; select(posts: FeedPost[], profile?: TargetProfile): { likeable: FeedPost[]; skipped: { urn: string; reason: string }[] } }`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/engagement/LikeFilter.test.ts
import { describe, it, expect } from 'vitest'
import { LikeFilter } from './LikeFilter'
import type { FeedPost, TargetProfile } from '@lib/types'

const post = (over: Partial<FeedPost>): FeedPost => ({ urn: 'u', authorName: 'a', text: 'A normal, genuine professional post about work.', ...over })

describe('LikeFilter', () => {
  const filter = new LikeFilter()

  it('likes a normal post', () => {
    expect(filter.worthLiking(post({})).ok).toBe(true)
  })

  it('skips an already-liked post', () => {
    expect(filter.worthLiking(post({ alreadyLiked: true }))).toEqual({ ok: false, reason: 'already_liked' })
  })

  it('skips an empty/too-short post', () => {
    expect(filter.worthLiking(post({ text: 'hi' })).reason).toBe('empty')
  })

  it('skips obvious promo/ads (case-insensitive)', () => {
    expect(filter.worthLiking(post({ text: 'Use code SAVE20 — sign up now!' })).reason).toBe('promo')
    expect(filter.worthLiking(post({ text: 'Full guide — Link in comments 👇' })).reason).toBe('promo')
  })

  it('skips a hashtag wall', () => {
    expect(filter.worthLiking(post({ text: 'launch #a #b #c #d #e #f #g' })).reason).toBe('hashtag_wall')
  })

  it('select splits likeable/skipped and orders stack-relevant first', () => {
    const profile: TargetProfile = { stack: ['Vue'], targetRoles: [], geos: [], watchlistCompanies: [] }
    const out = filter.select(
      [
        post({ urn: '1', text: 'random cooking thoughts for the weekend' }),
        post({ urn: '2', text: 'shipping a new Vue component library today' }),
        post({ urn: '3', text: 'great giveaway! use code FREE' })
      ],
      profile
    )
    expect(out.likeable.map((p) => p.urn)).toEqual(['2', '1']) // Vue post first
    expect(out.skipped).toEqual([{ urn: '3', reason: 'promo' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engagement/LikeFilter.test.ts`
Expected: FAIL — cannot resolve `./LikeFilter`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/engagement/LikeFilter.ts
import type { FeedPost, TargetProfile } from '../types'
import { RelevanceScorer } from './RelevanceScorer'

const PROMO_PHRASES = [
  'link in comments',
  'dm me',
  'promo code',
  'giveaway',
  'sponsored',
  'use code',
  'sign up now'
]
const MIN_TEXT = 8
const MAX_HASHTAGS = 6

export interface LikeVerdict {
  ok: boolean
  reason?: string
}

/**
 * Broad "is this worth a like?" filter (design-spec §4.1). A like is cheap and
 * reversible, so we like widely and only skip obvious junk. Targeting by stack is
 * a *sort key* here (relevant first when budget is tight), never a gate — that
 * belongs to comments. Pure.
 */
export class LikeFilter {
  private readonly scorer = new RelevanceScorer()

  worthLiking(post: FeedPost): LikeVerdict {
    if (post.alreadyLiked) return { ok: false, reason: 'already_liked' }
    const text = post.text.trim()
    if (text.length < MIN_TEXT) return { ok: false, reason: 'empty' }
    const lower = text.toLowerCase()
    if (PROMO_PHRASES.some((p) => lower.includes(p))) return { ok: false, reason: 'promo' }
    if ((text.match(/#/g) ?? []).length >= MAX_HASHTAGS) return { ok: false, reason: 'hashtag_wall' }
    return { ok: true }
  }

  select(
    posts: FeedPost[],
    profile?: TargetProfile
  ): { likeable: FeedPost[]; skipped: { urn: string; reason: string }[] } {
    const likeable: FeedPost[] = []
    const skipped: { urn: string; reason: string }[] = []
    for (const post of posts) {
      const verdict = this.worthLiking(post)
      if (verdict.ok) likeable.push(post)
      else skipped.push({ urn: post.urn, reason: verdict.reason ?? 'skip' })
    }
    if (profile) {
      likeable.sort((a, b) => this.scorer.score(b, profile) - this.scorer.score(a, profile))
    }
    return { likeable, skipped }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engagement/LikeFilter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engagement/LikeFilter.ts src/lib/engagement/LikeFilter.test.ts
git commit -m "feat(engagement): LikeFilter — broad junk filter, stack as sort key"
```

---

### Task 4: Orchestrator contains executor failures

**Files:**
- Modify: `src/lib/engagement/EngagementOrchestrator.ts` (the `'execute'` branch of `submit`, and the `SubmitOutcome` union)
- Modify: `src/lib/engagement/EngagementOrchestrator.test.ts`

**Interfaces:**
- Produces: `SubmitOutcome` gains `| { status: 'failed'; reasons: string[] }`. `submit` returns `failed` (and does NOT spend budget) when `executor.execute` throws.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/engagement/EngagementOrchestrator.test.ts` inside the `describe`:

```typescript
  it('contains an executor failure: returns failed, does not spend budget, does not throw', async () => {
    const store = memStore()
    const { clock } = mutableClock(START)
    const orch = new EngagementOrchestrator({
      gate: new ActionGate(),
      judge: new CommentJudge(),
      quarantine: new QuarantineQueue({ store, clock, scheduler: noopScheduler, newId: counterIds() }),
      store,
      clock,
      executor: { async execute() { throw new Error('tab gone') } },
      newId: counterIds()
    })
    const out = await orch.submit(like, cfg('full_auto'))
    expect(out).toEqual({ status: 'failed', reasons: ['tab gone'] })
    // budget not spent → a fresh full_auto would still be allowed
    expect(await store.get('engagement:budget:like')).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engagement/EngagementOrchestrator.test.ts`
Expected: FAIL — currently the thrown error rejects `submit` (uncaught), so the test errors instead of getting `failed`.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/engagement/EngagementOrchestrator.ts`, extend the `SubmitOutcome` union:

```typescript
export type SubmitOutcome =
  | { status: 'executed' }
  | { status: 'queued'; id: string }
  | { status: 'quarantined'; id: string }
  | { status: 'blocked'; reasons: string[] }
  | { status: 'skipped'; reasons: string[] }
  | { status: 'failed'; reasons: string[] }
```

Replace the `case 'execute':` block in `submit`:

```typescript
      case 'execute': {
        try {
          await this.deps.executor.execute(action)
        } catch (e) {
          return { status: 'failed', reasons: [e instanceof Error ? e.message : String(e)] }
        }
        await this.spend(action.type, budgetState, now)
        return { status: 'executed' }
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/engagement/EngagementOrchestrator.test.ts`
Expected: PASS (all, including the new test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engagement/EngagementOrchestrator.ts src/lib/engagement/EngagementOrchestrator.test.ts
git commit -m "feat(engagement): contain executor failure as a 'failed' outcome"
```

---

### Task 5: EngagementRunner v2 — broad filter + failed tally

**Files:**
- Modify: `src/lib/types.ts` (add `failed` to `EngagementRunSummary`)
- Modify: `src/lib/engagement/EngagementRunner.ts`
- Modify: `src/lib/engagement/EngagementRunner.test.ts`

**Interfaces:**
- Consumes: `LikeFilter` from `./LikeFilter`.
- Produces: `EngagementRunner` deps gain `likeFilter: LikeFilter`; `run` uses `likeFilter.select` instead of per-post `scorer.isRelevant`; `EngagementRunSummary` gains `failed: number`; `summary.relevant` = number of likeable candidates.

- [ ] **Step 1: Write the failing test**

Replace the body of `src/lib/engagement/EngagementRunner.test.ts` with:

```typescript
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
    async get<T>(k: string) { return m.has(k) ? (m.get(k) as T) : null },
    async set<T>(k: string, v: T) { m.set(k, v) }
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

function build(executor: ActionExecutor) {
  const store = memStore()
  const orchestrator = new EngagementOrchestrator({
    gate: new ActionGate(),
    judge: new CommentJudge(),
    quarantine: new QuarantineQueue({ store, clock, scheduler: noop, newId: () => 'id' }),
    store, clock, executor, newId: () => 'id'
  })
  return new EngagementRunner({ harvest: async () => posts, likeFilter: new LikeFilter(), orchestrator })
}

describe('EngagementRunner (broad likes)', () => {
  it('likes all non-junk posts (A,B), skips promo (C) and already-liked (D)', async () => {
    const executed: ActionRequest[] = []
    const runner = build({ async execute(a) { executed.push(a) } })
    const summary = await runner.run(settings)
    expect(summary.scanned).toBe(4)
    expect(summary.relevant).toBe(2)   // likeable candidates A,B
    expect(summary.executed).toBe(2)
    expect(summary.skipped).toBe(2)    // C promo, D already_liked
    expect(executed.map((a) => a.target.meta?.urn)).toEqual(['A', 'B']) // Vue post first
  })

  it('counts a failing action as failed and keeps going', async () => {
    let n = 0
    const runner = build({ async execute() { if (n++ === 0) throw new Error('boom') } })
    const summary = await runner.run(settings)
    expect(summary.failed).toBe(1)
    expect(summary.executed).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engagement/EngagementRunner.test.ts`
Expected: FAIL — `likeFilter` not a dep / `summary.failed` undefined / still uses relevance gate.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/types.ts`, add `failed` to the summary:

```typescript
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
```

Replace `src/lib/engagement/EngagementRunner.ts` with:

```typescript
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
        target: { url: 'https://www.linkedin.com/feed/', meta: { urn: post.urn, author: post.authorName } }
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
    case 'executed': summary.executed++; break
    case 'queued': summary.queued++; break
    case 'quarantined': summary.quarantined++; break
    case 'skipped': summary.skipped++; break
    case 'blocked': summary.blocked++; break
    case 'failed': summary.failed++; break
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/engagement/EngagementRunner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/engagement/EngagementRunner.ts src/lib/engagement/EngagementRunner.test.ts src/lib/types.ts
git commit -m "feat(engagement): runner v2 — broad LikeFilter pass + failed tally"
```

---

### Task 6: Wire runner deps + content-script scroll-harvest

**Files:**
- Modify: `src/service-worker/index.ts` (pass `likeFilter` to the runner)
- Modify: `src/content/index.ts` (scroll-harvest loop behind `REQUEST_FEED_POSTS`)

**Interfaces:**
- Consumes: `FeedAccumulator`, `ScrollHarvestPolicy`, `LikeFilter`, `FeedReader`, `HumanDelay`.
- Produces: `REQUEST_FEED_POSTS` returns up to `message.limit` posts gathered by scrolling.

This task is an edge wiring change; its pure collaborators are already tested. Verify with `npm run build` + the live run in Task 8.

- [ ] **Step 1: Update the SW runner construction**

In `src/service-worker/index.ts`, add the import and pass `likeFilter`:

```typescript
import { LikeFilter } from '@lib/engagement/LikeFilter'
```

Replace the `runner` construction:

```typescript
const runner = new EngagementRunner({
  harvest: (limit) => harvestPosts(limit),
  likeFilter: new LikeFilter(),
  orchestrator,
  pace: () => sleep(humanDelay.nextMs(8000, 45000))
})
```

(Remove the now-unused `RelevanceScorer` import if nothing else uses it.)

- [ ] **Step 2: Replace the content-script harvest with a scroll loop**

In `src/content/index.ts`, add imports:

```typescript
import { FeedAccumulator } from '@lib/feed/FeedAccumulator'
import { ScrollHarvestPolicy } from '@lib/feed/ScrollHarvestPolicy'
```

Replace `harvestWhenReady` with a scroll-harvest loop:

```typescript
// Scroll the feed human-like, harvesting unique posts until the target is met or
// the feed stops yielding new posts. Variable pauses (Rng) = anti-ban.
async function harvestByScrolling(target: number): Promise<ReturnType<FeedReader['parse']>> {
  const acc = new FeedAccumulator()
  const policy = new ScrollHarvestPolicy({ maxStaleRounds: 2, maxRounds: 15 })
  let staleRounds = 0
  for (let round = 0; ; round++) {
    const added = acc.add(feed.parse(document))
    staleRounds = added > 0 ? 0 : staleRounds + 1
    if (policy.shouldStop({ collected: acc.size(), target, staleRounds, round })) break
    window.scrollBy(0, Math.round(window.innerHeight * 0.85))
    await sleep(delay.nextMs(700, 1800))
  }
  return acc.items().slice(0, target)
}
```

Update the `REQUEST_FEED_POSTS` case to use it:

```typescript
    case 'REQUEST_FEED_POSTS':
      void harvestByScrolling(message.limit).then(sendResponse)
      return true // async sendResponse
```

- [ ] **Step 3: Build to typecheck the wiring**

Run: `npm run build`
Expected: `vue-tsc` clean, `vite build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/service-worker/index.ts src/content/index.ts
git commit -m "feat(content): auto-scroll feed harvest; wire LikeFilter into the runner"
```

---

### Task 7: Reliable summary delivery + content re-inject fallback (SW)

**Files:**
- Modify: `src/service-worker/index.ts`

**Interfaces:**
- Produces: `RUN_ENGAGEMENT` resolves the summary via `sendResponse`; `sendToLinkedInTab` re-injects the content script once on "no receiver".

- [ ] **Step 1: Make RUN_ENGAGEMENT reply with the summary**

In `src/service-worker/index.ts`, change the handler:

```typescript
    case 'RUN_ENGAGEMENT':
      void runEngagement().then(sendResponse)
      return true // async sendResponse
```

And make `runEngagement` return the summary (still broadcasts for any passive listeners):

```typescript
async function runEngagement(): Promise<import('@lib/types').EngagementRunSummary> {
  const settings = await loadSettings(store)
  const summary = await runner.run(settings)
  broadcast({ type: 'ENGAGEMENT_RESULT', summary })
  return summary
}
```

- [ ] **Step 2: Re-inject the content script on "no receiver"**

Replace `sendToLinkedInTab`:

```typescript
async function sendToLinkedInTab<T>(message: BeaconMessage): Promise<T | undefined> {
  const tab = await activeLinkedInTab()
  if (!tab?.id) return undefined
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) as T
  } catch {
    // The content script may be missing (extension reloaded after the tab loaded).
    // Best-effort re-inject, then retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/index.ts-loader.js'] })
    } catch {
      return undefined
    }
    try {
      return (await chrome.tabs.sendMessage(tab.id, message)) as T
    } catch {
      return undefined
    }
  }
}
```

NOTE: the exact injected file is the crxjs content loader. After Step 3, confirm the real filename in `dist/manifest.json` → `content_scripts[0].js[0]` and use that literal path. If the path is unstable, keep the first `catch` returning `undefined` (the panel already guides the user to refresh the feed) and skip the re-inject — do not block the increment on it.

- [ ] **Step 3: Build + confirm the content loader path**

Run: `npm run build && cat dist/manifest.json`
Expected: build green; read `content_scripts[0].js` and reconcile the `executeScript` `files` path with it (edit the literal if needed).

- [ ] **Step 4: Commit**

```bash
git add src/service-worker/index.ts
git commit -m "fix(sw): reply RUN_ENGAGEMENT summary via sendResponse + re-inject content"
```

---

### Task 8: Panel reads the summary via request + live verification

**Files:**
- Modify: `src/sidepanel/composables/useEngagement.ts`

**Interfaces:**
- Consumes: `panelBus.request<EngagementRunSummary>`.
- Produces: `runCampaign()` awaits the summary and sets `summary.value`.

- [ ] **Step 1: Await the summary in the composable**

In `src/sidepanel/composables/useEngagement.ts`, change `runCampaign`:

```typescript
  const runCampaign = async () => {
    const result = await panelBus.request<EngagementRunSummary>({ type: 'RUN_ENGAGEMENT' })
    if (result) summary.value = result
    await loadQuarantine()
  }
```

Add the import:

```typescript
import type { ActionQueueItem, EngagementRunSummary } from '@lib/types'
```

(`ENGAGEMENT_RESULT` broadcast listener stays — harmless redundancy.)

- [ ] **Step 2: Build + full test suite**

Run: `npm run build && npx vitest run`
Expected: both green.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/composables/useEngagement.ts
git commit -m "feat(sidepanel): runCampaign awaits the run summary via request"
```

- [ ] **Step 4: Live verification (real account — user authorized real likes)**

1. `npm run build` → reload the unpacked extension → open a LinkedIn `/feed/` tab and refresh it once.
2. In the engagement card, set a stack (any) and level **Полный авто**; click **Запустить кампанию**.
3. Expect: the feed scrolls on its own; a summary appears (`просмотрено N · релевантных M · выполнено K`); several non-junk posts show their reaction button flipped to **Like**; promo/already-liked posts are untouched; ~8–45 s between likes.
4. Confirm no console errors in the service-worker devtools.

---

## Self-Review

**Spec coverage:** auto-scroll harvest → Tasks 1,2,6. Broad LikeFilter → Task 3. Run orchestration (filter→gate→execute→pace→summary) → Task 5. Per-action failure containment → Task 4. Summary via sendResponse → Task 7. Content re-inject → Task 7. Panel shows summary → Task 8. All spec sections covered.

**Placeholder scan:** No TBD/TODO; every code step has full code. The one conditional is Task 7's re-inject file path, which carries an explicit fallback instruction (not a placeholder).

**Type consistency:** `FeedPost`, `TargetProfile`, `EngagementRunSummary` (now with `failed`), `SubmitOutcome` (now with `failed`), `LikeFilter.select` shape, `EngagementRunnerDeps.likeFilter` — names/signatures match across tasks 3/4/5/6.

## Out of scope (increments 2 & 3)

Ideas from the whole feed + idea-bank screen + LLM key settings (inc 2); stack→LLM→skip comments (inc 3). Not in this plan.
