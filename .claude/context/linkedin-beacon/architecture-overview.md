# Beacon — Architecture Overview

> Memory-bank for `linkedin-beacon`. Committed to git (SSOT, shared). Read this
> first each session, then `progress.md` + `gotchas.md`.

## ⭐ Product essence — the NORTH STAR (read before designing anything)

**Beacon is an AUTOMATION extension for growing LinkedIn SSI by pull > push.**

- **Goal = inbound interest, not activity volume.** The metric that matters is "how
  many people wrote to YOU" (recruiters come on their own to a high SSI) — NOT how
  much you posted. Everything serves raising the 4 SSI pillars.
- **Method = safe automation in the user's real browser.** likes → comments →
  recruiter connects → content. Anti-ban beats speed (hence pacing + human breaks).
  Human-in-the-loop only where irreversible (posts) — and that's a property of the
  module, never a user-facing toggle.
- **It is a compact personal tool, not an enterprise dashboard. Simplicity is a
  feature.**

### The ONE-BUTTON principle (agreed 2026-06-25 — applies to ALL future phases)

> Configure modules once → press one button → walk away.

- **«Модули» = the single config hub.** Each module card = enable toggle + ONE
  per-module limit with a recommended hint (likes/day, connects/week, posts/week).
  No automation-level selector (manual/guardrails/full was micro-management — removed).
- **Dash = the single launch.** One «Запустить» (tab or worker-window host). It runs
  EVERY enabled module up to its limit, autonomously, in the safe tempo, then reports.
- **One budget per module.** The limit is the `DailyCeiling` base; actual cap is
  `base ± jitter` (+ warmup) — never a fixed number (plausibility). No second counter.
- **Every NEW module plugs into THIS one run** + its own limit in «Модули» + a «Скоро»
  badge until built. NEVER add a separate launch point or per-module run button.
- Removed this session: the one-shot «Запустить кампанию» (`RUN_ENGAGEMENT`) and the
  automation-level UI — they fractured the one-button essence. Don't reintroduce them.

Design/plan for the consolidation: `docs/superpowers/{specs,plans}/2026-06-25-automation-consolidation*`.

## Sources of truth (do NOT lose these)

- **Design spec (product vision):** https://artifacts.kanev.space/beacon-design-spec/ (v0.4)
  — §2.3 execution model, §4 modules, §5 anti-ban, §5.5 automation levels.
- **Design demo (UI pixel-target):** https://artifacts.kanev.space/beacon-linkedin-ssi/
  = `docs/design-reference.html`. Tokens: lime `#c4ff4d` + blue `#4d9fff` on dark;
  fonts Space Grotesk + Spline Sans Mono.
- **Tasks:** Todoist project **LinkedIn Beacon** (id `6gwm9gxgmgcr7JQW`, under Business).
  Token in `~/.claude/skills/todoist/token.txt`. API is **v1** (`https://api.todoist.com/api/v1/...`),
  v2 is deprecated. Close a task: `POST /api/v1/tasks/<id>/close`.
- **Implementation specs/plans:** `docs/superpowers/specs/` + `docs/superpowers/plans/`.
- **Live LinkedIn DOM anchors:** `docs/linkedin-dom-anchors.md` (validated against the
  real authorized feed — selectors below).
- **Backlog (parked ideas):** `docs/backlog.md`.

## Stack

Chrome MV3 extension. Vue 3.5 + TS + Vite 6 + `@crxjs/vite-plugin` + Vitest (npm).
sidePanel API. Permissions (`manifest.config.ts`): sidePanel, storage, scripting,
alarms, tabs, cookies. `chrome.windows` needs no permission.

## Hexagonal layering (strict — dependencies point inward)

```
core (src/lib, pure, 100% unit-tested)   ← ports (src/lib/ports.ts)   ← adapters (src/adapters, thin edge)
```
- **core** never imports chrome/document/fetch. Randomness via `Rng` port, time via
  `Clock`, storage via `KeyValueStore`, alarms via `AlarmScheduler`, HTTP via `HttpClient`.
- **Layers:** `sidepanel` (Vue UI) → `service-worker` (orchestrator + gatekeeper) →
  `content` (the ONLY layer in the LinkedIn DOM). SW never touches the DOM.
- File ≤ 300 lines, one responsibility (SOLID). OCP via registries/strategies
  (LLM providers, SSI strategies, action guards) — add a class, don't edit a switch.

## Key modules (src/lib)

- `ssi/`, `ssi-api/`, `refresh/` — Phase 1 SSI engine (internal API primary + DOM fallback).
- `feed/` — `FeedReader` (parse live feed), `FeedAccumulator` (dedup across scroll),
  `ScrollHarvestPolicy` (when to stop scrolling).
- `engagement/` — `RelevanceScorer`, `LikeFilter` (broad junk filter, stack = sort key
  not gate), `DailyBudget`, `HumanDelay`, `CommentDraftService`+`CommentJudge`,
  `EngagementOrchestrator` (budget→judge→gate→quarantine/execute), `EngagementRunner`,
  `settings.ts` (+ `asArray` coercion helper — see gotchas).
- `gate/` — `ActionGate` (manual→queue / guardrails→judge+quarantine / full→execute),
  `QuarantineQueue` (alarms + persist, cancel window).
- `ideas/` — `IdeaExtractor` (anti-slop: feed = signal, not template) + `IdeaBank`.
- `autopilot/` — `DailyCeiling`, `BurstGuard`, `RiskAssessor`, `HumanBreakPolicy`,
  `AutopilotGatekeeper` (act/wait/stop, precedence manual>risk>budget>burst),
  `RunReportStore`, `resolveDailyBudget` (day-keyed carry-over).

## Adapters (src/adapters)

`ChromeStorageStore`, `SystemClock`, `MathRandomRng`, `ChromeAlarmScheduler`,
`ChromeWindows`, `FetchHttpClient`, `ChromeCookieCsrfProvider`, `DomSsiSource`,
`randomId`. Content DOM executors: `src/content/domActions.ts` (`executeLike`,
`executeComment` via ProseMirror execCommand).

## Messaging

`BeaconMessage` discriminated union in `src/lib/types.ts`. Content switch uses
`assertNever` (exhaustive); SW switch uses `default: return false`. Reliable
request/response: `panelBus.request` + SW `sendResponse` (broadcasts can be missed).

## Product invariants (never break)

1. Read metrics via internal API; **actions (like/comment) via DOM** human-like (anti-ban).
2. **Every action through the gate** (automationLevel + budget + quarantine) from commit 1.
3. `automationLevel` per-module, default **manual**. Lives in `modules:state` (SSOT) —
   `loadSettings` derives `config.level` from it.
4. Feed feeds the FIRST idea step (signal), never the last (echo = AI-slop).
5. Likes broad (cheap/reversible); comments narrow + judged; posts **approve-first**.
   *Content Pipeline v2 shift (2026-06-26):* the human still approves every post by hand
   (explicit «Одобрить» → `Draft.approved`), so approve-first holds — but the **mechanical
   publish** of an already-approved draft is now an automated step inside «Запустить»
   (`publishApprovedThen`), gated by `publishDays` (default Пн/Ср/Пт) + weekly `postsPerWeek`,
   **one post per run**. Old wording "posts never in a run" is superseded: only *publishing*
   of human-approved drafts runs; nothing auto-approves.
6. LLM behind `LlmProvider` port; keys via backend proxy (infra task), never in the extension.
7. UI 1:1 with the demo.
