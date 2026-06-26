# Beacon — Progress (as of 2026-06-26, late)

`main` is the working branch (Vlad commits directly to main — built-in memory `direct-to-main`).
**354 tests green, `npm run build` clean.** ⚠️ **23 commits in LOCAL `main` NOT pushed to origin**
(c45553a..87fec0b) — Smart Connect + ideas fix. Vlad pushes himself; offer/confirm before pushing.

## This session (2026-06-26) — Smart Connect (SSI people+relationships) — SHIPPED & live-verified
Full detail in `smart-connect.md`. Built via brainstorm→spec→plan→subagent-driven TDD (11 tasks),
then a long live-debug round that fixed why connects "entered /search/ and snapped back":
- ROOT bugs fixed: navigation race (PING raced the dying /feed script → channel closed → empty harvest);
  people-search renders ~3s late + **pagination not infinite scroll**; `targetRegions` array-as-object;
  activity overlay dies on each nav; run report omitted connects; daily-cap gap.
- Added: multi-region geoUrn targeting (US/Canada/UAE/Europe/Asia, verified live), day-keyed cap,
  connect history (who+when) on Reports.
- **Vlad confirmed connects send live.** Couldn't fully self-verify end-to-end — I throttled my own
  debug session by hammering LinkedIn search (→ empty results to me); Vlad's manual session works.

## Also fixed this session
- **Ideas bug (`bf69521`):** `IdeaExtractor maxTokens:600` starved gemini-3.5-flash (reasoning model) →
  empty content → 0 ideas. Dropped the cap. ⚠️ Vlad reports ideas STILL empty after → a SECOND cause
  remains (debug next session).

## NEXT TASK — "Content Pipeline v2" (Vlad's direction, approved; brainstorm next session)
1. **Fix ideas generation** (still empty on Content tab; surface the swallowed in-loop extraction error).
2. **Draft «Одобрить для публикации» button** → mark approved.
3. **Auto-publish bot:** publishes approved drafts on configured **weekdays only** (no time — whenever
   the bot runs that day), as a step in «Запустить», gated by `postsPerWeek`. Changes invariant #5's
   mechanism (human still approves each post; mechanical publish automated). Spec→plan→TDD.

## Prior shipped (live-verified on Vlad's account) — see git + architecture-overview
Phase 1 SSI · engagement (broad likes + auto-scroll, autonomous) · comments full-auto (judged, OFF by
default) · ideas-in-the-loop · Content Layer 2 (auto-publish via composer shadow-DOM/Quill) · content
language · automation consolidation (ONE-BUTTON: per-module limit, single «Запустить»).

## Known limitations / debt
- `service-worker/index.ts` + `content/index.ts` > 300-line rule (pre-existing router debt).
- `design-reference.html` smart_connect card diverged (old Note/fake-stats) — sync or update spec.
- Comments OFF by default (Vlad noticed only likes ran — expected; revisit after content v2).
- Deferred SDD minors in `.superpowers/sdd/progress.md` (test assertions; OK-to-defer per final review).
