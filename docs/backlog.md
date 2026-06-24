# Backlog — parked ideas (design later)

Captured during the engagement-v2 work. Not yet designed/scheduled. Each gets its
own brainstorm → spec → plan when picked up.

## 1. Autonomous mode — one button, multi-module, drains the daily budget (§2.3)

**Vision:** one **«Запустить»** = autopilot. It reads which **modules are enabled**
(engagement / smart-connect / content) and works each up to its **daily/weekly
budget** (budget = "how much", not a timer — anti-ban is about volume + rate).
Press it, park the window on a second monitor, forget. At the end → a **report**.

Decided so far:
- Stop criterion = **daily/weekly budget per module** (randomised ceiling), not a
  per-session count and not a wall-clock timer.
- **Module-aware**: only enabled modules run; today only engagement-likes acts
  end-to-end (comments = increment 3 / needs LLM key; smart-connect + content =
  future, DOM adapters not built). Others report "not yet available".
- New **«Отчёты» (Reports) tab**: each run persists a `RunReport` (timestamp +
  per-module tallies: done / skipped / failed). Tab lists recent runs.

Open architecture questions (resolve in the brainstorm):
- **Where the continuous loop lives** (MV3 resilience): a 20–40 min run vs the SW
  being evicted on idle + unreliable `setTimeout`. Options: active feed tab
  (content script drives it, tab stays alive while open), a **dedicated worker
  window** (`chrome.windows.create`, ideally a separate Beacon profile — the §2.3
  ideal, true set-and-forget), or `chrome.alarms`-chunked.
- Anti-ban depth for a long run: **work-hours window**, **burst-guard** (≤5 actions
  / 3 min, §5.2), randomised daily budgets, occasional "human breaks".
- Kill-switch / Stop control to abort mid-run.

## 2. Usage telemetry — anonymous active-user count

**Goal:** know how many people use the extension.

- Thin `TelemetryClient` behind a port (mirrors the LLM provider): POST to
  `control.kanev.space` an **anonymous install UUID** (generated once, stored in
  `chrome.storage`; no PII, no LinkedIn data) + extension version + a daily
  heartbeat. Backend counts unique IDs → active users.
- **Must be disclosed + opt-out** (a "send anonymous stats" toggle + a README /
  privacy line). Minimal data only.
- Requires a small endpoint on the control backend.
