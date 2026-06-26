# Smart Connect — Design (V1)

**Date:** 2026-06-26
**SSI levers:** **people** + **relationships** (both 🔴 today). Smart Connect is the
rycar that raises them: find relevant people and send connection requests.
**Status:** approved (brainstorming). Next: writing-plans → TDD.
**Recon:** live, read-only, on Vlad's authorised account — selectors in
`docs/linkedin-dom-anchors.md` ("Smart Connect" section). No invite was ever sent.

---

## 1. Decisions (locked)

| # | Decision | Value |
|---|----------|-------|
| Surface | where connects happen | **People-search page** (in-page `Connect` `<a>` + shadow modal). NOT the feed (feed authors only offer *Follow*, verified live). |
| Targets | who to add | **All connectable search results** — recruiters AND potential colleagues/peers. The search query does the targeting; **no relevance scorer**. |
| "Who to search" | config | One plain editable field **«Кого искать»** (search keywords, e.g. `frontend recruiter`), default = user's stack + `recruiter`. Replaces the old "expertise" abstraction (expertise stays only for likes/LLM, untouched). |
| Gate | send approval | **Auto** (connects fire during the one run, like likes) — fixed module property, NOT a user toggle. |
| Note | personal note | **Bare invite ("Send without a note")**. Personal notes are monthly-capped on free (verified live: "N personalized invitations remaining for this month"), so notes are deferred to a later layer with a separate tiny monthly budget. |
| Weekly cap | anti-ban budget | **`connectsPerWeek` default 100**, jitter **downward only** (never exceeds 100). Single user knob in «Модули». |
| One-button | integration | Connects run inside the existing **«Запустить»**, sequenced after feed-engagement (likes → comments → connects). No separate run button (ONE-BUTTON principle). |

---

## 2. Flow (how it plugs into the one-button run)

Connects are a **step in the single run**, orchestrated from the **service worker**
(not the feed loop — it's a different page). Posts remain excluded from the run
(approve-first, invariant #5). Order matches the architecture: likes → comments → connects.

```
feed engagement (likes/comments) finishes
  → SW: navigate the worker tab to the people-search URL (built from «Кого искать»)
  → SW: PING content until ready (navigation re-injects the content script)
  → SW → content: HARVEST_PEOPLE  → parse result cards → PersonCandidate[]
  → SW/core: select = dedup vs persisted sent-set → skip non-connectable → budget gate
  → for each, up to per-run cap, paced (HumanDelay + BurstGuard + HumanBreakPolicy):
        SW → content: EXECUTE_ACTION { type:'connect', candidate }
        content: pierce #interop-outlet.shadowRoot → click Connect <a> → poll modal
                 → click "Send without a note" → confirm card flips to "Pending"
  → SW: record week usage + add ids to sent-set → run report (with headlines, for transparency)
```

**Empty «Кого искать» / no query** → connect step is skipped with a clear status, never crashes.

---

## 3. Surface & DOM contract (from live recon)

Full table in `docs/linkedin-dom-anchors.md`. Load-bearing facts:

- **Search URL:** `https://www.linkedin.com/search/results/people/?keywords=<urlencoded>`.
- **Connect control is an `<a>`, NOT a `<button>`:**
  `a[aria-label^="Invite "][aria-label$=" to connect"]` (text `Connect`). Querying
  `button[aria-label]` MISSES it — the core trap.
- **Person id / dedup key:** the connect anchor's `componentkey` =
  `ConnectButtonstate:invitation:urn:li:member:<numericId>_connect` → use `urn:li:member:<numericId>`.
- **Card parse (jsdom-safe, structural, no innerText / no hashed classes):** from the
  connect anchor walk up to the first ancestor containing `a[href*="/in/"]`; within it
  `card.querySelectorAll('p')` = `[name(+degree), headline, location]` → headline = `ps[1]`.
  name from the connect aria-label; profileUrl from `a[href*="/in/"]`.
- **Skip states:** `a[aria-label^="Follow "]` (no connect), a `Message` button (already
  connected), `Pending` (already invited). Skip, do not error.
- **Invite modal (in `#interop-outlet`.shadowRoot, same host as the composer):**
  - bare send: shadow `button[aria-label="Send without a note"]` (enabled immediately) — **V1 path**.
  - modal: shadow `[role="dialog"][aria-labelledby="send-invite-modal"]`.
  - abandon on failure: shadow `button[aria-label="Dismiss"]`.
  - sent signal: card flips `Connect` → `Pending`; modal closes.
  - **Same shadow-DOM gotchas as the composer:** pierce strictly via `#interop-outlet.shadowRoot`,
    async render → poll the button, re-query nodes (held refs go stale).

---

## 4. Budget model (anti-ban — non-negotiable)

Connecting is the **highest-ban-risk action** in the product (LinkedIn restricts on
invite volume + low accept-rate). The flagship's bar is high.

- **User knob:** `connectsPerWeek` (default 100) — the only setting.
- **`ConnectWeekBudget`** (ISO-week, pure — mirrors `PostWeekBudget`): tracks used/week,
  jitter **downward only** so a week never exceeds 100.
- **Per-run/daily sub-cap (critical):** firing the whole weekly budget in one walk-away
  run = instant restriction. Per run, cap = `min(weekly remaining, dailyShare)` where
  `dailyShare ≈ connectsPerWeek / 7 ± jitter`. Apply the same pacing *mechanism* as the
  engagement autopilot (day-keyed carry-over à la `resolveDailyBudget`, `BurstGuard`,
  `HumanBreakPolicy`) but over a **separate connect budget** — connects do not share the
  likes' counter. Daily is derived internally — **not** a second user toggle (ONE-BUTTON).
- **Human tempo** between connects (≥ the like cadence; connects cost more).
- **Persisted sent-set** keyed by `urn:li:member:<id>` (same pattern as likes' `actedUrns`):
  the search returns the same top results each run; without it run #2 re-targets the same
  people.
- **Search commercial-use limit (free, monthly):** ≤ 1 search per run + cache candidates;
  detect a limit/upsell banner (`/commercial use limit|monthly limit|reached the (monthly )?limit/i`)
  → abort the connect step gracefully. (Not hit during recon.)

---

## 5. Components (hexagonal — dependencies point inward)

**core (`src/lib/connect/`, pure, 100% unit-tested):**
- `types.ts` — `PersonCandidate { memberId, name, headline, profileUrl }`.
- `peopleSearchUrl.ts` — `peopleSearchUrl(keywords): string` (build/encode the search URL).
- `ConnectWeekBudget.ts` — ISO-week budget, jitter-down ceiling (mirror `PostWeekBudget`).
- `selectCandidates.ts` — dedup vs sent-set + skip non-connectable + apply per-run cap.
- `settings.ts` — `connectSearchKeywords` (default from stack + `recruiter`), `connectsPerWeek`.

**adapters (`src/content/`, thin, impure — boundary-tested):**
- `harvestPeople()` — parse result cards → `PersonCandidate[]` (round-trip the real HTML fixture).
- `executeConnect(candidate)` in `domActions.ts` — pierce shadow, click Connect, poll modal,
  click "Send without a note", confirm `Pending`; any failure → Dismiss. Mirrors `executeComposerPost`.

**service worker (`src/service-worker/`, unit-tested with fakes):**
- new action type `connect` in `EXECUTE_ACTION`; new message `HARVEST_PEOPLE`.
- connect step appended to the run (navigate → ping → harvest → select → paced execute → record).
- extend the run-loop modules signal to include `smartConnect`.

**UI (`src/sidepanel/`):**
- `smart_connect` card → `available: true` (remove «Скоро»), enable toggle, weekly limit
  input (default 100), **«Кого искать»** keywords field.

---

## 6. Increments (build standalone first, wire the run last — lowest risk)

1. **core** — types, `peopleSearchUrl`, `ConnectWeekBudget`, `selectCandidates`, settings. Pure TDD.
2. **`harvestPeople`** — boundary test against the real captured card HTML fixture.
3. **`executeConnect`** — boundary test against a jsdom shadow fixture; then **live-verify in
   isolation** (mirrors how the composer was proven) — Vlad authorises **1 real connect**, then
   withdraws it from Sent invitations.
4. **SW selection + connect action + HARVEST_PEOPLE** — unit with fakes.
5. **Wire into the one-button run** (navigate → ping → harvest → connect step) — **last**, the
   riskiest part (navigating the tab re-injects the content script and kills the feed loop).
6. **UI** — smart_connect card.

---

## 7. Testing (boundary rule — iron law)

- `harvestPeople`: round-trip parser over the **real captured card HTML** (recon fixture).
- `executeConnect`: jsdom shadow fixture (host `#interop-outlet` + open shadowRoot with the
  invite modal) — the test **crosses the real DOM boundary** (clicks the shadow buttons).
- `peopleSearchUrl`, `ConnectWeekBudget`, `selectCandidates`, settings — pure unit.
- Real send — live via CDP (Vlad authorises; increment 3).

Pre-commit checkpoint per increment: is there a test that REALLY crosses the boundary
(parses real HTML / triggers the real shadow click)? If no → write it first.

---

## 8. Out of scope / deferred

- **Personal notes** (monthly-capped on free) — later layer with a separate tiny monthly budget for top targets.
- **Relevance scorer** — dropped; the search query is the targeting (Vlad: connect to recruiters + peers both).
- **Feed-author connects** — feed offers Follow only; not pursued.
- **PYMK source** — search is the V1 source.
- **Accept-rate tracking / withdraw automation** — future (feeds the "Эффект недели" stub).

---

## 9. Open questions

None blocking. Default «Кого искать» = stack + `recruiter`, editable — confirmed.
