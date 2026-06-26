# Design — SSI pull side: Profile Audit + Profile Views

> Date: 2026-06-26. Research-FIRST. Grounding: `docs/research/2026-06-26-ssi-pull-research.md`
> (primary source LinkedIn Help `a105145` + All-Star `a594698`). North Star: raise SSI via the
> PULL side (the current gap). Two features, both research-confirmed.

## Goal

Add the two missing PULL levers to Beacon's SSI engine:

- **B. Profile Audit (Brand pillar)** — read-only completeness checklist grounded in LinkedIn's
  official All-Star spec. Tells the user exactly what to finish.
- **A. Profile Views (People pillar)** — visit N target profiles/day from people-search inside the
  one «Запустить». Pure views, NO invite (safest LinkedIn action). Fills a real gap: the People
  pillar (`a105145`: people searches + **profile views** + days active) currently has NO lever —
  `weeklyGoal.ts` mis-maps it to Smart Connect (connects = Relationships, not People).

Non-goals (out of scope): inbound-views handling (research = MYTH), Sales Navigator integration
(research = not a multiplier, free-account ceiling ~75), SSI history charts, real Inbox.

## Research constraints baked into the design (do not violate)

- **Outgoing profile views raise People (CONFIRMED).** Build around viewing, not being viewed.
- **Sales Navigator is not a multiplier.** No SN dependency; honest ceiling ~75 note.
- **Acceptance rate is a confirmed Relationships factor** — noted, but bare-invite targeting is a
  separate (queued) concern; here we only fix the stale `weeklyGoal` "персональный Note" string.
- **Audit honesty:** Tier-1 = official All-Star (hard, gates %); Tier-2 = best-practice (soft).
  NEVER present Tier-2 as a "LinkedIn-confirmed SSI factor".

---

## Feature A — Profile Views module (`profile_views`)

### Architecture
A new run-step module, mirroring Smart Connect's shape. Plugs into the single «Запустить»
(ONE-BUTTON invariant): own card in «Модули» + own daily limit + own step in `launch()`. Pure
views, no invite.

### Flow (SW-orchestrated, a step in `launch()`, like `runConnectsThen`)
`runViewsThen(tabId)`:
1. Navigate worker tab to people-search (`peopleSearchUrl(keywords, geoUrns)` — reused).
2. Harvest candidates (`harvestPeoplePaginated` — reused), poll-for-render + paginate.
3. `selectProfilesToView` — dedup vs viewed-set + cap to the run budget.
4. For each profile: `navigateLinkedInTab` ready-gate → open profile URL → human dwell
   (scroll a little + pause) → back → human pace pause. Re-assert `SET_ACTIVITY` after each nav.
5. Record each viewed profile in `ViewHistory`; report count in the run report.

Order in the run: `runViewsThen` BEFORE `runConnectsThen` (viewing warms; safest first). Both
steps run before the engagement loop (same waiver as Smart Connect per invariant #2).

### Targeting — SSOT
Reuses Smart Connect's `searchKeywords` + `targetRegions` (from `src/lib/connect/settings.ts`).
NO duplicate config. The module card states "использует таргет Smart Connect" and shows only its
own daily limit. (If Smart Connect targeting is empty, the step uses the same default as connects.)

### Core (pure, src/lib/views/) — tests FIRST
- `ViewDayBudget.ts` — day-keyed daily cap + per-run jitter-down. Modeled on `ConnectWeekBudget`
  but DAY-ONLY (no weekly). `viewRunCap(daily, rng)` → plausible per-run number ≤ remaining today.
- `selectProfilesToView.ts` — dedup vs viewed-set + cap (mirrors `selectCandidates`).
- `ViewHistory.ts` — who + when, newest-first, capped (mirrors `ConnectHistory`).
- `settings.ts` — `loadViewSettings`/`saveViewSettings` only if needed; targeting comes from
  connect settings (SSOT), so this may just expose the daily limit (which lives in `modules:state`).

### Adapters / content
- Reuse `harvestPeople` / `harvestPeoplePaginated` / `goToNextPeoplePage`.
- New `executeProfileView(profileUrl)` in `src/content/domActions.ts` (or a focused new file):
  navigate to the profile, dwell (scroll + pause via injected delays), return. Read-only.

### SW
- `src/service-worker/viewHandlers.ts` — `runViewStep` (gates + budget + history), injectable
  deps (Clock/Rng/Store/HttpClient) for unit/boundary tests, like `connectHandlers.ts`.
- `src/service-worker/index.ts` — `runViewsThen(tabId)` wired into `launch()`; views line in the
  run report. (Watch the 300-line debt — extract into `runSteps.ts` if `index.ts` grows.)

### Anti-ban (same gate family as Smart Connect — a fixed module property, NOT a user toggle)
- Day-keyed cap, **default 40/day** (views are read-only/safest → ~2× connects). Configurable in
  the card.
- Per-run jitter-down + human pace pauses between views + dwell on each profile.
- `viewed-set` dedup (don't re-view the same profile within the window).
- `navigateLinkedInTab` ready-gate (status:complete + url + ping) before each profile — avoids the
  nav-race that bit Smart Connect.
- Re-assert the activity overlay/pill after each navigation.
- **Honesty note (UI):** the real free-account constraint is the monthly commercial-use SEARCH
  limit (harvesting), not a view-ban; 40/day ≈ 4-5 search pages/day, comfortably inside it.

### UI
- `ModulesScreen.vue` — new card: toggle + daily limit (default 40) + "использует таргет Smart
  Connect" line + a «Скоро»-style hint only until built (then live).
- `ReportsScreen.vue` — «Просмотрено профилей: N» + list (newest-first), alongside Лайки/Коннекты.

### Tests (boundary)
- `harvestPeople` reuse: existing fixtures cover the parser.
- `runViewStep` boundary: fake Store/Clock/Rng/tab API → asserts budget honored, viewed-set
  dedup, history recorded, count reported (mirrors `connectHandlers.test.ts`).
- Message routing: `VIEW`/`RUN_VIEWS` (or reuse `EXECUTE_ACTION` with a view variant) gets a no-op
  `case` in the exhaustive content switch (or a real handler) so `vue-tsc` passes.

---

## Feature B — Profile Audit screen (Brand pillar)

### Architecture
A new read-only screen. NOT a run-step (it's not "an action up to a limit"; profile edits are
manual/irreversible). Reached via an «Аудит профиля» button on the SSI/Dash screen (not a 7th
bottom-nav tab — keeps nav clean). Refreshes on demand (open) + alongside the SSI refresh.

### Data — own profile → `ProfileSnapshot`
Read the user's OWN profile into a domain snapshot:
```
ProfileSnapshot {
  hasPhoto, hasBanner: boolean
  headline: string | null
  about: string | null            // About/Summary text
  location: string | null
  industry: string | null
  educationCount: number
  hasCurrentPosition: boolean
  pastPositionCount: number
  skillCount: number
  recommendationCount: number
  hasFeatured: boolean
  hasCustomUrl: boolean
}
```
- **Source:** internal voyager API primary + DOM fallback on `/in/me/` — the SAME dual-source
  pattern as SSI (`SsiSource` port). The EXACT endpoint/selectors are confirmed via live recon in
  the plan (do NOT invent them); the port + mapper are designed now, the wire is recon'd later.
- Port: `ProfileSource` (narrow, ISP) returning `ProfileSnapshot`. Core never touches the wire.

### Core (pure, src/lib/profile/) — tests FIRST
- `auditProfile(snapshot) → ProfileAudit`:
  ```
  AuditItem { key, label, tier: 'official' | 'best-practice', done: boolean, hint, editUrl }
  ProfileAudit { items: AuditItem[], completeness: number /* 0..100, Tier-1 only */,
                 isAllStar: boolean, officialDone: number, officialTotal: 7 }
  ```
- **Tier-1 (official All-Star, `a594698`) — 7 items, hard, gate `completeness`:**
  photo · location · industry · education(≥1) · current position · skills(≥5) · About(non-empty).
- **Tier-2 (best-practice, convergent practitioner signal) — soft, separate "усиление" list:**
  banner · specific headline · recommendations(≥3) · Featured present · custom URL · past
  positions(≥2).
- `completeness` = Tier-1 done / 7 × 100. `isAllStar` = all 7 done. Tier-2 surfaced as
  recommendations, NOT counted in completeness.
- Each item carries a `hint` (what to do) + an `editUrl` (deep link to the LinkedIn edit surface).

### UI — `ProfileAuditScreen.vue`
- Completeness ring (Tier-1 %), All-Star badge when 7/7.
- Checklist: Tier-1 (done/missing, gating), then Tier-2 «Усиление» (best-practice, clearly
  labeled as not-official).
- Per-item edit link.
- Honest copy: «потолок ~75 без Sales Navigator» + «дни активности тоже растят People» (from
  research). Brand-pillar tie-in.
- Entry: «Аудит профиля» button on the SSI/Dash screen.

### Tests
- `auditProfile` unit: snapshots → expected checklist, completeness math, All-Star gate, Tier
  separation. (Pure, exhaustive.)
- `ProfileSource` boundary: fake HttpClient returning a realistic voyager/own-profile shape →
  mapper → `ProfileSnapshot` (crosses the API boundary, CLAUDE.md iron rule). DOM fallback tested
  against a saved own-profile HTML fixture.

---

## Cross-cutting (research-driven corrections)

- `ModuleId` += `'profile_views'` (`src/lib/types.ts`).
- `defaultModules()` += `{ id: 'profile_views', enabled: false, automationLevel: 'manual',
  available: true, dailyLimit: 40 }`. `mergeWithDefaults` backfills existing storage automatically.
- **Fix `weeklyGoal.ts` lever-map:** `people → profile_views` (research: People = views/searches/
  days-active, NOT connects). Keep `relationships → smart_connect` but fix the stale «персональный
  Note» string → bare-invite truth (queued honesty debt, fixed here since we touch the file).
- Honesty plates surfaced from research (ceiling ~75, days-active bonus, SSI de-emphasized but
  live).
- Content message switch stays exhaustive (`assertNever`) — any new variant gets a `case`.

## Hexagonal placement (invariants)
- `core` (`src/lib/views/`, `src/lib/profile/`) — pure, 100% unit-tested, no chrome/document/fetch.
- Ports: reuse `Clock`/`Rng`/`KeyValueStore`/`HttpClient`; new `ProfileSource` (narrow).
- Adapters thin: profile reader (API + DOM fallback), `executeProfileView`.
- SW orchestrates (`runViewsThen`, profile-read handler); content is the only DOM layer.
- File ≤ 300 lines; split long units. OCP: new module is a new step, not a switch edit where
  avoidable.

## TDD order (per increment: test → code → commit, direct-to-main)
1. Core pure: `ViewDayBudget`, `selectProfilesToView`, `ViewHistory`; `auditProfile`; `weeklyGoal`
   lever-map fix. (Full TDD, pure.)
2. Boundary: `ProfileSource` mapper (realistic API shape) + DOM fallback fixture; `runViewStep`
   handler (fake deps); message routing build-verified.
3. Adapters/wire: `executeProfileView`, profile reader, `runViewsThen` step, profile-read handler.
   Live recon confirms the real endpoint/selectors before wiring (NOT invented).
4. UI: `profile_views` module card + Reports split; `ProfileAuditScreen` + Dash entry button.
5. **advisor before edge-wiring and before «готово».** `npx vitest run` + `npm run build` green;
   `git status` clean after each task.

## Open questions (resolved)
- Profile-views architecture → separate module (chosen).
- Profile-audit placement → new screen, Dash-button entry (chosen).
- Views default → 40/day (chosen).
- Tier-2 audit scope → banner, headline, recommendations(3+), Featured, custom URL, past
  positions(2+) (proposed; trim during impl if a field isn't cheaply readable).
- Exact profile endpoint/selectors → recon in plan (deliberately deferred, not invented).
