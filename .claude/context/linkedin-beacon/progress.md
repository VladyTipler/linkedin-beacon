# Beacon — Progress (as of 2026-06-24)

`main` is the working branch (user commits directly to main this project). 201 tests
green, `npm run build` clean. Repo: GitLab `v_sandz/linkedin-beacon`.

## Done & live-verified (on Vlad's real authorized LinkedIn account)

- **Phase 1 (SSI):** internal-API SSI + DOM fallback, background refresh, sidebar 4
  screens 1:1 with demo, LLM layer (OpenRouter + Gemini behind a factory).
- **Engagement increment 1 — broad likes + auto-scroll:** one click → scroll-harvest
  a batch → `LikeFilter` (broad, junk only) → gate → `executeLike` → 8–45s pacing →
  daily budget → summary via sendResponse. Live: real likes landed on DOM. Spec/plan:
  `docs/superpowers/{specs,plans}/2026-06-24-engagement-v2-increment-1*`.
- **Autonomous mode:** one button → continuous loop (in feed content script, survives
  SW eviction) → likes to a **daily** ceiling (random base±jitter + warmup, day-keyed
  carry-over so re-runs don't re-grant) → BurstGuard (≤5/3min) + human breaks +
  RiskAssessor kill-switch. Host = tab | worker window (`chrome.windows.create`).
  Reports persisted → «Отчёты» tab (5th nav). Start/Stop on Safety screen.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-06-24-autonomous-mode*`.
  Live-verified: budget-stop (2 real likes), manual-stop, worker-window open,
  window-close→report, daily carry-over (re-run kept used, stopped on budget).

## Known limitations (honest — flagged, not silent)

- **Autopilot budget pool is separate from the manual "Run campaign" pool**
  (`autopilot:state.used` vs `engagement:budget:like`). Combined daily volume not
  unified. Candidate follow-up: route autopilot likes through `EngagementOrchestrator`/
  `DailyBudget`, or share one day-keyed counter.
- **Unverified-live (unit/trace-only):** `feed_exhausted`, risk-stop, burst-`wait`
  paths — short ceiling=2 test runs always stopped on budget first; exhausting a real
  feed is impractical. Code traced correct.
- **No settings UI for the LLM key** → comments/ideas pipelines not runnable end-to-end yet.
- Comments: `executeComment` insertion validated live (ProseMirror execCommand), but
  submit-button selector `/^(comment|post|reply)$/i` NOT confirmed live.

## Not built yet (future increments — see docs/backlog.md)

- **Content module (inc 2+3):** idea-bank screen; Settings tab with a custom post-generator
  prompt; «Черновики» tab (approve/reject/edit → publish via composer DOM adapter).
  Posts = human-in-the-loop by default, NOT full-auto (§5.5).
- **Smart Connect** (recruiter connect + Note) and **content posting** DOM adapters.
- **Usage telemetry:** anonymous install-UUID heartbeat → control.kanev.space (opt-out, disclosed).
- Unify the two budget pools (above).

## Todoist phase mapping (numbering differs from spec!)

Todoist "Фаза 2 — Модуль вовлечённости (лента)" = the engagement module = **DONE & closed**.
Smart Connect is Todoist Фаза 3; content autopilot Фаза 4. Engagement-v2 (broad likes)
+ autonomous mode were NOT in the original Todoist task tree — they came from Vlad's
mid-session redirection (broad likes, ideas from diverse feed, one-button autopilot).
