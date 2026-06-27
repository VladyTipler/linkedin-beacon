# Profile Views — shipped (2026-06-27, v0.6.0)

Raises SSI **people** pillar (the gap: `a105145` — People = outgoing profile views + searches + days-active,
NOT connects). Inside the ONE-BUTTON «Запустить»: people-search → visit N target profiles/day → human dwell →
back to feed. Pure views, NO invite (safest LinkedIn action). **LIVE-VERIFIED** on Vlad's account (2 recruiter
profiles visited, history/budget/seen-set recorded). Research: `docs/research/2026-06-26-ssi-pull-research.md`.

## Flow (SW-orchestrated, runs FIRST in `launch()`, before connects)
`runViewsThen(tabId)`: gate on `viewsEnabled` + empty-keywords guard → people-search (reuses `peopleSearchUrl`/
`geoUrnsForRegions`/`harvestPeople` from Smart Connect) → `runViewStep`: day-budget cap → select fresh (dedup vs
seen-set) → per profile: `navigateLinkedInTab` ready-gate → `DWELL_PROFILE` (scroll+pause) → record → pace → back to /feed.

## Files
- core `src/lib/views/`: `ViewDayBudget.ts` (day-keyed cap + `viewRunCap` jitter-down, default 40/day, `viewsPerDay`,
  VIEW_SEEN_KEY) · `ViewHistory.ts` (`appendViewHistory` newest-first, cap 500).
- SW `src/service-worker/`: `viewHandlers.ts` (`runViewStep` — gate+budget+seen-set+history, boundary-tested with
  fake deps; persist-only-on-success via `if(records.length)` + `Promise.all`) · `index.ts` `runViewsThen` +
  `viewsExecuted` in state + report line. Reuses `selectCandidates` for dedup.
- content `src/content/`: `profileView.ts` `executeProfileView` (best-effort scroll dwell) · `index.ts` `DWELL_PROFILE` case.
- UI: `ModulesScreen.vue` card (toggle + лимит, «использует таргет Smart Connect», honesty: read-only/ceiling~75) ·
  `ReportsScreen.vue` (Просмотры split + viewed-profiles list).

## Decisions (locked)
- **Targeting SSOT:** reuses Smart Connect `searchKeywords`+`targetRegions` (no duplicate config). Empty keywords → return 0, zero nav.
- **Views run BEFORE connects** in the run (safest first). Same anti-ban gate family as connects (day-cap+jitter+pace+seen-set+ready-gate+overlay re-assert) — a fixed module property, not a toggle.
- **The view = the SW navigating to the profile URL** (that GET counts); content only does a human dwell (no new ActionType — uses `DWELL_PROFILE` message).
- `weeklyGoal` lever-map fixed: `people → profile_views` (was wrongly → connects).

## Gotchas
- `runViewStep` persists history/budget/seen-set ALL AT END (persist-only-on-success) — during a run, storage shows
  0 until the step finishes. (Bit the live-smoke verification: poll until non-empty, don't conclude 0 mid-run.)
- seen-set eviction must keep NEWEST: `.slice(-5000)` (was `.slice(0,5000)` → dropped recent, caught in final review).
- Live-smoke: extension was loaded STALE (0.1.0) — must Reload (⟳) in chrome://extensions to pick up fresh dist;
  drive from Vlad's FOREGROUND tab (WSL-driven backgrounded tab throttles timers → fake hang, see gotchas.md).

## Profile Audit (Brand) — screen shipped, real reader DEFERRED
`auditProfile()` (official All-Star 7 hard + best-practice soft, honest framing) + `ProfileAuditScreen` built, but on
DEMO data; Dash entry hidden (`AUDIT_ENTRY_ENABLED=false`). Real reader = NEXT TASK — see built-in memory
`profile-reader-false-negatives` (naive reader gives false "missing X"; `/voyager/api/me` is hash-free for
photo/headline/banner/url; deep fields = lazy rotating-hash graphql; recommended hybrid /me + DOM-scroll + honest unknown).
