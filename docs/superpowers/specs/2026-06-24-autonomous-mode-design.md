# Autonomous mode — one button, runs enabled modules to the daily budget

> Status: approved design (2026-06-24). Methodology: Spec → Plan → TDD.
> Source product vision: https://artifacts.kanev.space/beacon-design-spec/ (§2.3 execution
> model, §5 anti-ban, §5.5 automation levels). This doc is the **implementation design**
> that resolves that vision into concrete components + the brainstorm decisions below.
> Builds on `2026-06-24-engagement-v2-increment-1-design.md` (broad-like pass + auto-scroll).

## Motivation

Today "Запустить кампанию" runs ONE pass (~25 posts) and stops. The user wants
**set-and-forget**: press one button, the extension figures out from the **enabled
modules** what to do and keeps going until each module's **daily budget** is spent,
then shows a **report**. Park the window on a second monitor and walk away.

The hard parts are (a) a continuous 20–40 min loop that survives MV3 service-worker
eviction, and (b) anti-ban discipline strong enough for a sustained run, not just a
single burst.

## Brainstorm decisions (the choices this design encodes)

1. **Loop host = user choice**: the current feed tab, OR a dedicated worker window
   the extension opens (`chrome.windows.create`) to park on a 2nd monitor. The loop
   itself lives in the **feed content script** either way — it stays alive while its
   tab is open, sidestepping SW eviction (§2.3: a tab is `visible`/un-throttled while
   active in its own window, even if that window isn't focused).
2. **Daily ceiling = random around a base**: user sets a base (e.g. 40); each day the
   engine draws `base ± jitter` (e.g. 30–50) via the `Rng` port, plus a **warmup**
   ramp for new accounts. Not a fixed number, not a wall-clock timer.
3. **Full anti-ban for a continuous run**: existing 8–45 s pacing **+** `BurstGuard`
   (≤ 5 actions / 3 min) **+** occasional "human breaks" (1–3 min) **+** a
   `RiskMonitor` kill-switch (captcha / challenge / 429 → global stop). Work-hours
   gating is explicitly **out** of this increment.
4. **Module-aware**: the run executes only **enabled** modules; today only
   engagement-likes acts end-to-end. Others appear in the report as "not yet
   available". New modules plug in via a registry (OCP) without rewriting the loop.
5. **Reports**: every session persists a `RunReport`; a new **«Отчёты»** tab lists
   them. Start/Stop controls; a live status dot in the top bar.

## Scope

**In:**
- Continuous autonomous engagement-likes loop in the content script, hosted in the
  current tab or a dedicated worker window (user choice).
- SW as the authoritative **gatekeeper**: daily ceiling (random+warmup), `BurstGuard`,
  `RiskMonitor`/kill-switch — all persisted, all the source of truth.
- Human-break pauses; risk-signal reporting from content → SW stop.
- `RunReport` persistence + an «Отчёты» tab + Start/Stop + status dot.
- Module registry so enabled modules drive the run; engagement is the one live module.

**Out (later):**
- Smart-connect / content-post execution (no DOM adapters yet — future increments).
- Comments in the loop (needs the LLM key — content increment 3).
- Work-hours window, weekly budgets, separate Beacon Chrome profile.
- Cross-device report sync / backend.

## Architecture

Layers unchanged: `core (src/lib)` ← ports ← thin edge adapters / content script / SW.

```
[Panel] --START_AUTOPILOT{host}--> [SW]
   |                                 |-- ensure host: current tab | chrome.windows.create (worker window)
   |                                 |-- AutopilotController: holds session state, gatekeeping
   |   <--status/report broadcasts-- |
[Content script: AutopilotSession loop] <--AUTOPILOT_TICK/STOP--> [SW gatekeeper]
   per candidate:  ask SW "may I act?" -> {act | wait ms | stop reason}
                   executeLike -> report outcome -> pace + burst pause + maybe human break
```

### Core (pure, tested)

- **`DailyCeiling`** (`src/lib/autopilot/DailyCeiling.ts`) — `forDay(base, warmupDay, rng)`
  returns the day's like ceiling: `base ± jitter`, scaled down during warmup. Pure.
- **`BurstGuard`** (`src/lib/autopilot/BurstGuard.ts`) — rolling-window limiter.
  `check(timestamps: number[], now: number): { ok: boolean; waitMs: number }`; ≤ 5
  actions per 3 min (configurable). Pure (timestamps + now injected).
- **`RiskAssessor`** (`src/lib/autopilot/RiskAssessor.ts`) — `classify(signals): 'ok' | 'stop'`
  from reported risk markers (`captcha`, `challenge`, `http_429`, `moving_too_fast`). Pure.
- **`HumanBreakPolicy`** (`src/lib/autopilot/HumanBreakPolicy.ts`) — `nextBreakMs(actionsSinceBreak, rng)`:
  occasionally (e.g. every 6–10 actions) returns a 1–3 min pause, else 0. Pure.
- **`AutopilotGatekeeper`** (`src/lib/autopilot/AutopilotGatekeeper.ts`) — composes the
  above + `DailyBudget`/`ActionGate`. `decide(state): { action: 'act' | 'wait' | 'stop';
  waitMs?; stopReason?: 'budget' | 'risk' | 'manual' }`. Pure decision; the SW owns the
  persisted state it reads/writes.
- **`RunReport`** model + **`RunReportStore`** (`src/lib/autopilot/RunReportStore.ts`) —
  persist/list reports (cap N, newest first). Fake-store tested.
- **Reuse**: `FeedReader`, `FeedAccumulator`, `ScrollHarvestPolicy`, `LikeFilter`,
  `EngagementOrchestrator`, `HumanDelay`, `DailyBudget`, `Rng`.

### Edge

- **Content `AutopilotSession`** — the loop: scroll-harvest a batch → `LikeFilter` →
  for each candidate ask the SW (`AUTOPILOT_MAY_ACT`) → on `act` run `executeLike`,
  report the outcome, then pace + burst pause + maybe a human break; on `wait` sleep;
  on `stop` end and report. Re-harvests (scrolls more) when the batch is exhausted and
  the budget isn't. Listens for `AUTOPILOT_STOP`. Reports risk markers it sees.
- **SW `AutopilotController`** — `START_AUTOPILOT{host}`: resolve/create the host
  (current LinkedIn tab, or `chrome.windows.create` a worker window pointed at
  `/feed/`), inject content if needed (re-inject helper from inc 1), then drive the
  session via messages, consulting `AutopilotGatekeeper`. On stop → write a `RunReport`,
  broadcast status. Holds the **global stop flag** (kill-switch).
- **`adapters/ChromeWindows`** — thin wrapper over `chrome.windows.create/remove` for
  the worker-window host.

### UI

- **«Отчёты» screen** (`src/sidepanel/screens/ReportsScreen.vue`) + a 5th bottom-nav
  entry — list of recent `RunReport`s (time, host, per-module done/skipped/failed, stop
  reason). Reuses demo tokens/cards.
- **Engagement card / Safety screen**: a host selector (tab | worker window), a daily-
  base input, **Запустить (autopilot)** + **Стоп** buttons, and a live status
  (running / idle / stopped-by-risk) — the demo's pulsing `Active` dot.

## Data model

```
interface RunReport {
  id: string
  startedAt: string; endedAt: string
  host: 'tab' | 'window'
  stopReason: 'budget' | 'risk' | 'manual' | 'feed_exhausted'
  modules: { id: ModuleId; executed: number; skipped: number; failed: number }[]
}
interface AutopilotState {        // persisted in chrome.storage, SW-owned
  running: boolean
  host: 'tab' | 'window'; windowId?: number
  ceiling: number                 // today's drawn ceiling
  actionTimestamps: number[]      // for BurstGuard (epoch ms, trimmed to window)
  actionsSinceBreak: number
  stopFlag: boolean               // kill-switch
}
```

## Message contract (additions to BeaconMessage)

- `START_AUTOPILOT { host: 'tab' | 'window' }` (panel → SW; replies started/ error)
- `STOP_AUTOPILOT` (panel → SW; sets stop flag)
- `AUTOPILOT_MAY_ACT { type: ActionType }` (content → SW; replies `{ action, waitMs?, stopReason? }`)
- `AUTOPILOT_ACTED { outcome }` (content → SW; updates budget/burst state)
- `AUTOPILOT_RISK { marker }` (content → SW; feeds `RiskAssessor`)
- `AUTOPILOT_STATUS { state }` / `AUTOPILOT_REPORT { report }` (SW → panel broadcast)
- `LIST_REPORTS` (panel → SW; replies `RunReport[]` via sendResponse)

## Error handling

- SW evicted mid-run → the content loop keeps going; it re-establishes state by asking
  the SW (which rehydrates `AutopilotState` from storage) on the next `AUTOPILOT_MAY_ACT`.
- Host tab/window closed by the user → SW detects via `chrome.tabs/windows.onRemoved`,
  marks the session stopped (`manual`), writes the report.
- `executeLike` fails → counted (inc-1 `failed` outcome), loop continues.
- Risk marker seen → gatekeeper returns `stop: risk`; SW sets the stop flag, the loop
  ends, report records `risk`; the panel surfaces the reason.
- Budget spent OR feed yields nothing new after scrolling → `stop: budget|feed_exhausted`.

## Testing (TDD, boundary-crossing where it matters)

- `DailyCeiling.test.ts` — base±jitter bounds via fixed Rng; warmup scales down; never 0.
- `BurstGuard.test.ts` — ≤5/3min passes; the 6th in-window returns `ok:false` + waitMs;
  old timestamps outside the window don't count.
- `RiskAssessor.test.ts` — each marker → stop; empty → ok.
- `HumanBreakPolicy.test.ts` — returns a 1–3 min pause on the Nth action (fixed Rng), else 0.
- `AutopilotGatekeeper.test.ts` — act when budget+burst+risk allow; wait when burst-limited;
  stop on budget/risk/manual; precedence (risk > budget > burst).
- `RunReportStore.test.ts` — persist/list newest-first, capped; survives across instances.
- `EngagementOrchestrator`/`DailyBudget` reuse — already tested.
- Live verification (real account, user-authorized): press Запустить (worker window),
  watch it scroll + like across multiple harvests, pause for human breaks, and stop at
  the day's ceiling; a report appears in «Отчёты»; Стоп aborts mid-run and writes a
  `manual` report; trip risk handling by closing the host window.
- Edge (content loop, SW controller, window adapter) — thin; covered by the live run +
  the pure gatekeeper tests it drives.

Green bar: `npx vitest run` + `npm run build` before any "done".

## Open questions

- Defaults to tune live: daily base (40?), jitter (±10), burst window (5 / 3 min),
  human-break cadence (every 6–10 actions, 1–3 min), warmup curve length.
- Worker-window UX: size/position hints; whether to reuse the main profile (separate
  Beacon profile is a later nicety, not this increment).
- Risk markers are best-effort DOM/heuristic detection; refine the set after live runs.
