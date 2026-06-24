# Engagement v2 — Increment 1: autonomous broad-like pass with auto-scroll

> Status: approved design (2026-06-24). Methodology: Spec → Plan → TDD.
> Source product spec: https://artifacts.kanev.space/beacon-design-spec/ (§4.1, §5).
> This is increment 1 of 3 (see "Roadmap"). LLM-free — testable end-to-end without a key.

## Motivation

The current engagement run gates likes behind a strict tech-stack keyword substring
match (`RelevanceScorer`). Two problems surfaced in field testing:

1. **Too narrow.** People post about diverse things; a literal stack-keyword gate
   skips almost everything, so a run typically likes nothing. Liking should be
   **broad** (a like is cheap, reversible, low-risk — it warms the network), with
   only obvious junk filtered out. Targeting by stack belongs to **comments**
   (increment 3), not likes.
2. **No feed scrolling + not "press-button-and-go".** The run only sees the ~3–8
   posts already rendered; it never scrolls to load more. Full automation means:
   one button → it scrolls, gathers a batch, likes broadly, paces itself, and
   reports a summary — no manual steps mid-run.

This increment delivers exactly that, with **no LLM dependency** (likes are
mechanical), so it is verifiable immediately.

## Scope

**In (increment 1):**
- Human-like **auto-scroll harvest** of the feed up to a target post count.
- **`LikeFilter`** — broad mechanical "worth a like?" filter (skip junk, not target by stack).
- Run orchestration: harvest → filter → gate (`automationLevel`) → `executeLike` → pace.
- **Summary delivery via `sendResponse`** (+ broadcast) so the panel reliably shows the result.
- **Resilience**: a per-action execute failure no longer kills the whole run; best-effort
  content-script re-inject so a stale tab doesn't silently yield zero.

**Out (later increments, noted for context):**
- Increment 2 — ideas from the **whole diverse feed** (`IdeaExtractor` → `IdeaBank`) + an
  idea-bank screen + LLM provider/key settings.
- Increment 3 — comments: stack-relevant candidates → LLM writes an expert comment or
  skips → `CommentJudge` → gate.
- Continuous / dedicated worker-window autonomous mode (design-spec §2.3).
- Work-hours window, warmup, risk-scoring (design-spec §5) — budgets + pacing only here.

## Architecture (units, each independently testable)

Layers unchanged: `core (src/lib)` ← ports ← thin edge adapters / content script.

### 1. Feed auto-scroll harvest (content script)

The content script gains a scroll-and-harvest loop behind the existing
`REQUEST_FEED_POSTS` message. It scrolls the feed human-like, re-parses with
`FeedReader` each round, and accumulates **unique** posts until a target is met or
the feed stops yielding new posts.

Pure, tested units:

- **`FeedAccumulator`** (`src/lib/feed/FeedAccumulator.ts`) — dedups `FeedPost[]`
  across scroll rounds by `urn`, preserves first-seen order.
  - `add(posts: FeedPost[]): number` → count of newly-added (not-seen) posts.
  - `size(): number`, `items(): FeedPost[]`.
- **`ScrollHarvestPolicy`** (`src/lib/feed/ScrollHarvestPolicy.ts`) — decides when to
  stop scrolling. Pure.
  - `shouldStop(s: { collected: number; target: number; staleRounds: number; round: number }): boolean`
  - Stops when `collected >= target`, OR `staleRounds >= maxStaleRounds` (no new posts
    for N consecutive rounds), OR `round >= maxRounds` (hard cap).
  - Config: `{ target = 25, maxStaleRounds = 2, maxRounds = 15 }`.

Edge (content script `harvestByScrolling(target)`):
```
acc = new FeedAccumulator()
policy = new ScrollHarvestPolicy(cfg)
staleRounds = 0
for (round = 0; ; round++) {
  const added = acc.add(feed.parse(document))      // FeedReader, deduped
  staleRounds = added > 0 ? 0 : staleRounds + 1
  if (policy.shouldStop({ collected: acc.size(), target, staleRounds, round })) break
  window.scrollBy(0, viewportStep)                 // human-like step
  await sleep(humanDelay.nextMs(700, 1800))        // variable "reading" pause (Rng)
}
return acc.items().slice(0, target)
```
Anti-ban: variable scroll pauses via the existing `HumanDelay`(`Rng`). No fixed cadence.

### 2. Broad like filter (pure)

- **`LikeFilter`** (`src/lib/engagement/LikeFilter.ts`) — replaces the strict stack gate
  for likes. Pure.
  - `worthLiking(post: FeedPost): { ok: boolean; reason?: string }`
  - Skip reasons: `already_liked` (`post.alreadyLiked`), `empty` (text shorter than a
    floor, e.g. < 8 chars), `promo` (matches an ad/promo phrase set:
    `["link in comments","dm me","promo code","giveaway","sponsored","use code","sign up now"]`,
    case-insensitive), `hashtag_wall` (≥ 6 `#` tokens).
  - Everything else → `ok`.
  - `select(posts, profile?): { likeable: FeedPost[]; skipped: {urn, reason}[] }` — applies
    `worthLiking`, and **orders** `likeable` so stack/role-relevant posts come first
    (via the existing `RelevanceScorer` as a *sort key only*, never a gate). When the
    daily budget is tighter than the candidate count, the most relevant get liked first.

### 3. Run orchestration (`EngagementRunner` v2)

`EngagementRunner.run` changes from "score-gate each post" to:
```
posts = await harvest(target)                       // scroll-harvest via content
const { likeable, skipped } = likeFilter.select(posts, settings.target)
for (post of likeable) {
  const outcome = await orchestrator.submit(likeAction(post), settings.config)
  tally(summary, outcome)
  if (outcome.status === 'executed' || 'quarantined') await pace()   // 8–45s
}
summary.scanned = posts.length; summary.skipped += skipped.length
return summary
```
- `pace` and the daily budget (per `ActionGate`/`DailyBudget`) are unchanged.
- The harvest target (25) and the daily like cap (60) bound the work.

### 4. Summary delivery + run resilience (service worker)

- **`RUN_ENGAGEMENT` replies with the summary via `sendResponse`** (handler returns
  `true`, resolves the summary), in addition to the existing `ENGAGEMENT_RESULT`
  broadcast. The panel awaits the response (`panelBus.request`) — reliable even when a
  broadcast to a given view is missed. Root cause of "I clicked and saw nothing".
- **Per-action failure is contained.** `EngagementOrchestrator` (or the runner) wraps
  `executor.execute` so a thrown error (e.g. stale tab) becomes an `{status:'failed'}`
  outcome counted in the summary, and the run continues to the next post instead of
  rejecting the whole pass silently.
- **Content-script re-inject fallback.** When `sendToLinkedInTab` rejects with "no
  receiving end", the SW attempts `chrome.scripting.executeScript` to (re)inject the
  content script into the feed tab, then retries once. If injection is unavailable, the
  summary carries a `needsActiveFeedTab` flag the panel surfaces ("open/refresh a
  LinkedIn feed tab"), instead of a silent zero. (Removes the manual-F5 requirement in
  the common case.)

## Data flow

```
[Panel] --RUN_ENGAGEMENT--> [SW.runEngagement]
   |                          |-- loadSettings (stack=comment-targeting; level from modules:state)
   |                          |-- harvest(target) --REQUEST_FEED_POSTS--> [Content: scroll-harvest loop -> FeedPost[]]
   |                          |-- LikeFilter.select -> likeable[]
   |                          |-- for each: ActionGate -> executeLike --EXECUTE_ACTION--> [Content: click reaction]
   |                          |-- pace 8-45s; tally
   |<------ sendResponse(summary) ------|  (+ ENGAGEMENT_RESULT broadcast)
[Panel shows summary]
```

## Error handling

- Harvest yields `[]` (no feed tab / content absent after re-inject attempt) → summary
  `{scanned:0, needsActiveFeedTab:true}`; panel shows guidance. No throw.
- `executeLike` returns `{ok:false,reason}` or throws → counted as `failed`, run continues.
- Budget exhausted → remaining candidates `skipped` (`budget_exhausted`). Expected, not an error.
- Scroll never loads new posts → policy stops after `maxStaleRounds`; harvest returns what it has.

## Testing (TDD, boundary-crossing where it matters)

- `FeedAccumulator.test.ts` — dedup by urn across rounds; new-count; order preserved.
- `ScrollHarvestPolicy.test.ts` — stop on target / stale rounds / max rounds.
- `LikeFilter.test.ts` — each skip reason (already-liked, empty, promo phrases, hashtag wall);
  ok for a normal post; relevance ordering puts stack-matching first without gating others.
- `EngagementRunner.test.ts` (extend) — harvest(fake) → filter → submit; summary tallies
  liked/skipped/failed; pacing only after real actions; a throwing executor is counted as
  `failed` and does not abort the run.
- Live verification (manual, real account — user authorized): button → it scrolls, likes a
  batch of non-junk posts, reaction buttons flip to "Like", summary shows counts.
- Edge (content scroll loop, SW re-inject) — thin, covered by the live run + the pure tests
  of the policy/accumulator it drives.

Green bar: `npx vitest run` + `npm run build` before any "done".

## Roadmap (increments 2–3, not implemented here)

- **Inc 2 — Ideas:** harvest (same scroll pass) → ALL posts → `IdeaExtractor` → `IdeaBank`
  → "Банк идей" screen; minimal LLM provider/key settings.
- **Inc 3 — Comments:** stack-relevant candidates → `CommentDraftService` returns an expert
  comment or `{skip}` → `CommentJudge` → `automationLevel` gate.

## Open questions

- Harvest target (25) and scroll step/pauses are starting defaults — tune after the live run.
- Content-script re-inject via `chrome.scripting` against the crxjs-built content bundle is
  best-effort; if the built path is awkward to target, increment 1 ships the
  `needsActiveFeedTab` guidance path and revisits auto-inject later.
