# Beacon — Architecture Overview

> Memory-bank for `linkedin-beacon`. Committed to git (SSOT, shared). Read this
> first each session, then `progress.md` + `gotchas.md`.

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
5. Likes broad (cheap/reversible); comments narrow + judged; posts approve-first (never full-auto by default).
6. LLM behind `LlmProvider` port; keys via backend proxy (infra task), never in the extension.
7. UI 1:1 with the demo.
