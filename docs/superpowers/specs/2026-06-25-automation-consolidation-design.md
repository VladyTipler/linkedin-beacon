# Automation Consolidation — one launch, config in «Модули»

**Date:** 2026-06-25
**Status:** Design approved, pending plan

## Why

Beacon is an **automation** extension for growing LinkedIn SSI (pull > push):
configure once, press one button, walk away. The current UI fractured that simple
essence into micro-management — two launch entry points doing the same thing
(«Запустить кампанию» one-shot + автопилот continuous), per-module automation-level
toggles, and two independent daily-budget counters. This consolidates to the
product's actual model: **one launch, per-module config in «Модули».**

## Target model

- **Dash (landing) = the single launch.** It already hosts «В этой вкладке / В
  окне-воркере» (commit `0c12e92`). Both hosts stay (tab for watching, worker-window
  for "park it and walk away"). This is the ONLY place you start automation.
- **«Модули» = the config hub.** Each module card = enable toggle + a **daily/weekly
  limit** input with a recommended hint. No automation-level selector.
- Pressing launch runs **every enabled module** up to its configured limit, in the
  safe anti-ban tempo, then reports. Today only the **engagement (likes)** module
  acts; smart-connect / content are configurable-but-**«Скоро»** (DOM adapters /
  approve-first not built) and report "module not yet active".

## What changes

### 1. «Модули» — limit input replaces the level selector

- `ModuleState` gains `dailyLimit: number` (per module: likes/day for engagement,
  connects/week for smart_connect, posts/week for content). Defaults: engagement 35,
  smart_connect 80, content 3 (mirrors the demo's limit bars).
- `ModuleCard` drops the `LEVELS` automation-level buttons (`manual` /
  `auto_guardrails` / `full_auto`) and renders a **number input** instead:
  «Лайков/день: [35]  рек. 30–40». For `available:false` modules the field is shown
  but disabled (under the «Скоро» badge).
- `useModules` drops `setLevel`, gains `setLimit(id, n)`. Persists the plain array
  (existing chrome.storage reactive-array gotcha guard stays).
- The `automationLevel` field on `ModuleState` is **left in place but no longer
  user-editable** (vestigial — `loadSettings`/`ActionGate` still reference it; the
  autopilot ignores it). Human-in-the-loop for the irreversible modules (posts,
  connects) becomes a property of those modules when built, not a user toggle.

### 2. The limit feeds the autopilot ceiling (with jitter preserved)

- The engagement module's `dailyLimit` becomes the **base** for `DailyCeiling`.
  The actual daily ceiling stays **`base ± jitter`** (+ warmup) — a fixed exact
  number every day is a bot signature, so plausibility jitter is kept. Only the
  base source changes: from a hardcoded value to the user's «лайков/день».
- `startAutopilot` reads the engagement `dailyLimit` from `modules:state` and passes
  it as the base to `dailyCeiling.forDay(...)`. Day-keyed carry-over (re-run same day
  doesn't re-grant) is unchanged.
- Comments (future) follow the same pattern: a target limit + jitter.

### 3. Remove the campaign entry point

- Delete «Запустить сегодняшнюю кампанию» from `SafetyScreen` and the
  `RUN_ENGAGEMENT` message + its SW handler (`runEngagement`) + `useEngagement`'s
  `runCampaign`. Safety keeps the quarantine list, the run summary, the anti-ban
  panel, and «Пауза всех модулей».
- The now-unused `engagement:budget:like` counter is dropped — `autopilot:state` is
  the single daily budget. (`EngagementRunner` / `EngagementOrchestrator` / `ActionGate`
  stay in `src/lib` — tested, reusable for gated comments later — but lose their
  campaign consumer.)

### 4. Budget unification (consequence, not extra work)

With the campaign gone, there is exactly one daily counter: `autopilot:state`
(used/ceiling), ceiling = engagement `dailyLimit ± jitter`. The known
"two independent budget pools" limitation is resolved by this removal.

## Out of scope

- Smart-connect / content **execution** (DOM adapters, posting) — still future; only
  their config fields appear, disabled under «Скоро».
- Deep removal of the `automationLevel` field and the `ActionGate` plumbing — left for
  a later cleanup once comments/connects define their own human-in-the-loop rules.
- Multi-module autonomous loop orchestration beyond likes — today the loop is the
  existing likes loop; the "run each enabled module" framing is honoured by reporting
  non-likes modules as "not yet active".

## Testing

- `ModuleState.dailyLimit` defaults + `useModules.setLimit` persistence (mem-store).
- `DailyCeiling` base now comes from config: a unit test that `forDay(base)` centres
  the jittered ceiling on the supplied base (existing jitter test adapted).
- `startAutopilot` reads the engagement `dailyLimit` as the base — boundary test via
  the SW (fake store) that the resolved ceiling derives from the module limit.
- `ModuleCard` renders a limit input (and no level buttons); disabled when `!available`.
- Removal: no test references `RUN_ENGAGEMENT` / `runCampaign` after deletion (the
  campaign specs are removed).
- Live (CDP): set «лайков/день» in Модули, launch from Dash, confirm the autopilot
  ceiling ≈ the set value ± jitter and likes land.

## Open questions

None blocking. Defaults chosen: limit lives on `ModuleState` (modules:state is the
module-config SSOT the «Модули» screen already owns); jitter/warmup mechanism
unchanged; campaign removed rather than hidden.
