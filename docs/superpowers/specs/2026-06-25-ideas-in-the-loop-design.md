# Ideas-in-the-Loop — Design Spec

**Date:** 2026-06-25
**Status:** Approved (brainstorming) → ready for plan
**Depends on:** follow-up #1 (`enabledModules` gate, commit `32dbfee`) — content becomes a
second runnable module, so "run only ENABLED modules" must already hold.

## 1. Problem & scope

Today the autopilot run scrolls the feed and **likes** it; the posts it harvests are thrown
away. Collecting **post ideas** is a separate **manual** button on the Content tab that
re-scrolls the feed and calls the LLM on its own. So "one button" does not collect ideas —
a gap against the north-star ("every module plugs into THIS one run").

**This slice:** while the autopilot run scrolls the feed, **passively accumulate** the posts
it already harvests, and **once per run** turn them into **grounded** content ideas that
appear in «Контент → Идеи». No new button, no extra scroll. Drafting an idea stays a click.

**In scope**
- Signal buffer riding the existing harvest (free, no extra LLM).
- One batch idea-extraction per run, capped by an ideas/day budget.
- Richer `Idea` shape with a **`spark`** (the concrete feed trigger + provenance) — the
  anti-slop core.
- `content` becomes a **real module** in «Модули» (toggle + ideas/day limit); «Скоро» lifted.
- Draft-on-click grounded in `idea.spark`.

**Out of scope (later increments)**
- Auto-drafting (machine writes a draft unprompted) — Layer 1.5.
- Publishing drafts via composer DOM adapter — **Layer 2** (the irreversible part, §5.5).
- Comments-in-loop (Phase C).

## 2. The anti-slop mechanism (the point of this design)

Generic slop happens when generation has **neither** a live signal **nor** a personal
perspective. Uniqueness comes from grounding in **both**:

1. **Signal grounding** — every idea is anchored to a **specific post resonating now**: its
   claim/tension + a short evidence quote + provenance (which post). Not "topic: remote
   work" but "post X argued Y → here is the tension worth a take."
2. **Perspective grounding** — the draft is written **through the user's expertise + voice**
   as their response/extension, never a paraphrase of the source.

Mechanically: enrich `Idea` with `spark`, keep provenance, and keep the existing invariant —
**the feed feeds the FIRST step (idea) as signal, never the last (the draft is generated
from idea+expertise, echoing the source post stays forbidden).** The `spark` is grounding
context for the draft, not text to rewrite. The ideas/day budget caps volume so the bank
never floods with weak ideas; the human curates which idea earns a draft.

## 3. Architecture (hexagon — dependencies point inward)

### Core (`src/lib`, pure, unit-tested)
- **`Idea` (extended, `types.ts`):** `{ topic, angle, spark? }`. `spark?: IdeaSpark` is
  **optional** for back-compat with already-stored `{topic,angle}` ideas.
  - `IdeaSpark = { claim: string; quote: string; source?: { author: string; id: string } }`
    — `claim`/`quote` from the LLM; `source` mapped by us from the post index (reliable
    provenance, no author hallucination).
- **`IdeaExtractor` (updated, `ideas/IdeaExtractor.ts`):** prompt now asks for, per idea,
  `sourceIndex` + `claim` + `quote` alongside `topic`/`angle`; the parser maps `sourceIndex`
  → `source {author,id}` from the input posts and tolerates a missing/out-of-range index
  (spark omitted, idea still kept). Anti-slop wording strengthened (ground each idea in one
  specific post; never copy).
- **Run signal buffer = `FeedAccumulator` (reuse, `feed/FeedAccumulator.ts`):** already
  dedups `FeedPost[]` by urn, first-seen order, `add`/`size`/`items`. No new class.
- **Ideas/day budget (new, `ideas/IdeaDayBudget.ts`):** day-keyed `{ day, used }` cap reusing
  the `resolveDailyBudget` carry-over pattern. `remaining(limit, day)` → how many ideas may
  still be stored today; `record(n)` bumps `used`. Pure.
- **`DraftGenerator` (updated, `content/DraftGenerator.ts`):** when `idea.spark` is present,
  the prompt uses `spark.claim`/`spark.quote` as the concrete hook — the user's take that
  responds to / extends the claim — **while still forbidding echo of the quote** (signal, not
  text to rewrite). Falls back to topic/angle-only when `spark` is absent (back-compat).
- **`enabledModules` (exists):** content now counts once `available:true && enabled`.

### Adapters / edges
- **Content loop (`content/index.ts`):** accumulate each harvest round into the run's
  `FeedAccumulator`; **like only if engagement is enabled**; when the buffer first reaches a
  target (and content enabled, budget remains, not yet extracted this run) **or** at run end,
  ask the SW to extract. New status label «Собираю идеи…» for the scroll-only path.
- **SW (`service-worker/contentHandlers.ts` + `index.ts`):** on the extract request, check
  content enabled + ideas/day remaining, run `IdeaExtractor` over the supplied buffer,
  `IdeaBank.add` (dedup), record budget. Reuses the existing `generateIdeas` LLM plumbing but
  fed the **provided** buffer instead of harvesting again. The manual «Сгенерировать идеи»
  button keeps working (same code path, ad-hoc harvest) and also yields sparks now.
- **`useModules.defaultModules` + ModulesScreen:** `content` → `available:true`,
  `enabled:false` (default off), `dailyLimit` repurposed as **ideas/day** (default 5, hint
  «рек. 3–6»). The existing module-card UI (toggle + limit input) renders it with no new
  component. `mergeWithDefaults` already pins `available` from the build, so the change ships
  cleanly.

### Messaging (`BeaconMessage`)
- **`AUTOPILOT_RUN_LOOP` gains a payload:** `{ modules: { engagement: boolean; content:
  boolean } }`, computed by the SW from `enabledModules(modules:state)` (SSOT in the SW). The
  content loop reads these flags to decide like vs. harvest-only and whether to extract.
- **New `EXTRACT_RUN_IDEAS` `{ posts: FeedPost[] }`** (content → SW, returns `{ stored:
  number; error?: string }`). Must get a **no-op `case` in the content `assertNever` switch**
  (gotcha: every new variant needs one or `vue-tsc` fails); the SW switch is lenient.

## 4. Data flow — the run

```
START (engagement and/or content enabled — else gated by follow-up #1)
SW → AUTOPILOT_RUN_LOOP { modules:{engagement, content} }
loop tick (content script):
  posts = harvestByScrolling(25)
  if content:   runBuffer.add(posts)                      // free, no LLM
  if engagement: fresh = likeFilter(posts); for each → AUTOPILOT_MAY_ACT → executeLike
  if content && !extractedThisRun && runBuffer.size() ≥ TARGET(25) :
      ask SW EXTRACT_RUN_IDEAS { posts: runBuffer.items() } ; extractedThisRun = true
  if !engagement && extractedThisRun:                     // content-only run is done
      endRun('feed_exhausted')
run end (any reason):
  if content && !extractedThisRun && runBuffer.size() ≥ FLOOR(8):
      ask SW EXTRACT_RUN_IDEAS (final catch-up)
SW EXTRACT_RUN_IDEAS:
  if !content-enabled → {stored:0}
  n = IdeaDayBudget.remaining(limit, today); if n ≤ 0 → {stored:0}
  ideas = IdeaExtractor.extract(posts→FeedItem, expertise)   // crosses the LLM mapper
  IdeaBank.add(ideas.slice(0, n)) ; IdeaDayBudget.record(stored) → {stored}
```

**Module matrix (the one-button promise):**
| engagement | content | run does |
|---|---|---|
| ✓ | ✓ | likes **and** collects ideas (main scenario) |
| ✓ | ✗ | likes only (today's behaviour) |
| ✗ | ✓ | scroll-only → collect ideas → end (no likes) |
| ✗ | ✗ | does not start (follow-up #1 hint) |

## 5. Budget, limits, errors

- **ideas/day** is the content module's `dailyLimit` (day-keyed via `IdeaDayBudget`); multiple
  runs in a day share it. Default 5.
- **No LLM key + content enabled:** extraction returns `{stored:0, error}` — surfaced once,
  **the run keeps liking**; ideas simply don't appear. Never crash the run.
- **Budget exhausted / buffer below FLOOR:** skip extraction silently (no error).
- **chrome.storage shape:** `IdeaBank.all()` gains an `asArray` guard (defensive; the
  array-as-object gotcha). `FeedAccumulator` is in-memory per run (no storage risk).
- **Idempotence:** one extraction per run (`extractedThisRun`); `IdeaBank` dedups by
  topic+angle so re-runs don't pile duplicates.

## 6. Testing (TDD — tests before code; boundary rule is law)

- **Pure:** `IdeaDayBudget` (day rollover, remaining/record, carry-over); `IdeaExtractor`
  parser (sourceIndex→source mapping, missing/out-of-range index tolerated, spark omitted but
  idea kept); `DraftGenerator` (spark present → prompt carries claim/quote, echo forbidden;
  spark absent → topic/angle fallback); `FeedAccumulator` dedup already covered.
- **Boundary (crosses the LLM mapper — the iron rule):** `IdeaExtractor`/`contentHandlers`
  extract test injects a fake `HttpClient & HttpGet` returning the **real OpenRouter shape**
  `{choices:[{message:{content:"[{topic,angle,sourceIndex,claim,quote}]"}}]}`, asserting the
  parsed `Idea[]` carries a populated `spark` with mapped provenance. Extends the existing
  `generateIdeas` boundary test.
- **Boundary (panel↔SW / loop wiring):** `contentHandlers` extract function unit-tested with
  injected deps (content-disabled → stored:0; budget-zero → stored:0; happy path → stored=n
  and IdeaDayBudget bumped). Loop trigger (`AUTOPILOT_RUN_LOOP.modules`, EXTRACT_RUN_IDEAS
  emission) verified by build + the existing live-CDP path.
- **UI:** `useModules` default — content `available:true`, `enabled:false`, ideas/day limit
  editable; ModulesScreen renders the content card (visual, exempt; data path tested).
- Gate: `npx vitest run` green + `npm run build` clean + `git status` clean.

## 7. Field-test (Vlad, live CDP)

Enable both modules → run autopilot on the real feed → it likes **and**, after ~25 posts,
«Контент → Идеи» fills with ideas that each cite a real source post (spark). «В черновик» →
the draft visibly reflects that spark, in your voice (not a paraphrase). Disable engagement,
enable only content → run scrolls without liking, gathers ideas, ends. Confirm ideas/day cap
holds across two runs. Sanity-check «Сгенерировать идеи» manual button still works.

## 8. Open questions

None blocking. Defaults chosen: TARGET=25, FLOOR=8, ideas/day=5 — tunable in the plan if the
live feel is off.
