# Content Pipeline v2 — Design Spec

**Date:** 2026-06-26
**Status:** Approved (brainstorm) → ready for plan
**Author:** Vlad Kanev + Claude

Standalone follow-up to Content Layer 2 (auto-publish via composer shadow-DOM/Quill,
already live-verified). Three parts: fix idea generation, add an "Approve" gate on
drafts, and auto-publish approved drafts as a step inside the single «Запустить».

---

## Goal & North-Star fit

Beacon grows LinkedIn SSI by **pull > push**, safety-first, one-button. Content v2 keeps
that: the human still approves every post by hand; only the **mechanical publish** of an
already-approved draft becomes automated as a gated run step. No new launch point, no
separate scheduler/alarm — everything plugs into the existing «Запустить».

---

## Part 1 — Fix idea generation (visibility + real fix)

### Problem

Ideas never appear on the «Контент» tab even though the feed loop repeatedly tries to
collect them. A prior fix (`bf69521`) removed an `IdeaExtractor maxTokens:600` cap that
starved the reasoning model — but ideas are still empty, so a **second cause** remains.

Root of the silence: `extractRunIdeas` (`src/service-worker/contentHandlers.ts:121–153`)
returns **`{ stored: 0 }` with no `error`** on two paths — content module disabled (line
129) and **daily ideas budget exhausted** (line 139). The in-loop caller in
`src/content/index.ts` invokes it fire-and-forget via `ask()`, which **discards the whole
response** (`{ stored, error? }`). The user sees the "Генерирую…" overlay, then 0 ideas and
no explanation.

### Approach (ordered — diagnose before building the real fix)

1. **Storage dump FIRST (live CDP, not code).** Read the persisted state before touching
   anything: `ideas:bank`, `ideas:budget` (`{ day, used }`), and what
   `moduleLimit(modules:state, 'content', 5)` returns. These three values discriminate
   every hypothesis in one shot:
   - **Prime suspect A — budget stuck:** `used >= limit` with an empty bank → line 139
     silently skips forever. Immediate fix once confirmed.
   - **Prime suspect B — limit collision:** the content module's single «Модули» limit is
     *posts/week*; confirm `ideasPerDayLimit` isn't reading it as *ideas/day* and coming
     back tiny/0.
   - LLM returns `[]` / swallowed parse error → distinguished by `ideas:bank` non-empty
     vs `lastRun.reason`.
   - (Disabled-path at line 129 is a backstop, not the cause: the loop only sends
     `EXTRACT_RUN_IDEAS` when content is enabled — unless `enabledModules` vs
     `runLoopModules` disagree on enabled-vs-available; worth one glance.)

2. **Diagnostic surface (TDD — built regardless of cause).** `extractRunIdeas` writes a
   persisted `ideas:lastRun` record on **every** exit path:
   ```ts
   interface IdeasLastRun {
     at: string                 // ISO timestamp (Clock port)
     reason: 'ok' | 'no_feed' | 'disabled' | 'no_key' | 'no_expertise'
           | 'budget_exhausted' | 'error'
     stored: number             // new ideas banked this run
     budget?: { used: number; limit: number }
     error?: string             // provider/parse message when reason==='error'
   }
   ```
   The two currently-silent paths become explicit (`disabled`, `budget_exhausted` with
   counts). Storage key `ideas:lastRun`. Storage is the SSOT and survives SW eviction — no
   fragile broadcast needed.

3. **ContentScreen shows it.** On the Ideas sub-tab, a status line under the generate
   button reads `ideas:lastRun`:
   - `ok` → «Последний автосбор: N идей (HH:MM)»
   - `budget_exhausted` → «Бюджет идей на сегодня исчерпан (used/limit)»
   - `error` → «Ошибка автосбора: <message>»
   - others → mapped to the existing `ERR` dictionary text.
   Loaded on mount and refreshed when an autopilot report broadcast arrives.

4. **Live-run → read `lastRun` → fix the confirmed cause + regression test.** The actual
   second-cause fix is an explicit plan step gated on the dump/visibility, because an
   unknown cause cannot be TDD'd up front. Once the dump pins it (e.g. budget-stuck), add a
   pure regression test for that exact failure and fix it.

### Boundary test

`extractRunIdeas` boundary test (fake `KeyValueStore` + fake LLM `HttpClient` returning the
real OpenRouter shape) asserts the `ideas:lastRun` record written on each path — crosses the
LLM + storage boundary.

---

## Part 2 — "Approve for publishing" button

### Changes

- **Model:** add `approved?: boolean` to the `Draft` interface (`src/lib/types.ts`).
  Optional → zero migration; existing drafts read back as `undefined` = **not approved**
  (confirmed decision: existing drafts are NOT auto-approved on rollout — safety-first).
- **Store:** `DraftStore.setApproved(id, approved: boolean)` — read-modify-write with the
  `asArray` guard, mirrors `update`/`remove`. **Client-side** in `useContent` (like
  `removeDraft`/`updateDraft`), no new SW message — `chrome.storage` is shared with the SW
  reader.
- **UI (`ContentScreen.vue`, drafts sub-tab):**
  - The current «Опубликовать» button (which published immediately) becomes **«Одобрить»**,
    which sets `approved = true` and does **not** publish.
  - ⚠️ The approve button is **NOT** gated by `postsLeft`. Approving = queueing, independent
    of the weekly cap — you can approve 5 drafts with `postsPerWeek = 3`; the cap throttles
    *publishing*, not approval. (Do not carry over the old `:disabled="postsLeft<=0"`.)
  - Approved drafts: inline badge «Одобрено ✓», sorted to the top, and the button toggles to
    «Отозвать» (un-approve → `approved = false`).
  - The direct publish-on-click path is removed from the UI. The `PUBLISH_POST` / `publishPost`
    machinery stays as the internal publish primitive reused by Part 3.

### Test

`DraftStore.setApproved` round-trip against an in-memory store (chrome.storage
array-as-object guard) — set true, read back; set false, read back; unknown id is a no-op.

---

## Part 3 — Auto-publish approved drafts as a «Запустить» step

### Settings

- `ContentSettings.publishDays: number[]` — weekdays (0 = Sunday … 6 = Saturday, JS
  `Date.getDay()` convention). **Default `[1, 3, 5]` = Mon/Wed/Fri.** Loaded with an
  `asArray` guard + validation (ints 0–6, deduped). Persisted in the existing
  `content:settings`.
- UI: weekday checkboxes (Пн–Вс) in the **SettingsScreen** content block, next to the
  existing `postsPerWeek` input. The «Модули» content card stays minimal (ONE-BUTTON).

### Core (pure, 100% unit-tested) — `src/lib/content/`

- `shouldPublishToday({ weekday, publishDays, remainingPosts, hasApproved }): boolean` —
  true iff `publishDays.includes(weekday)` AND `remainingPosts > 0` AND `hasApproved`.
- `pickOldestApproved(drafts: Draft[]): Draft | null` — the approved draft with the
  smallest `createdAt`. Sort by `createdAt` **explicitly** (don't rely on store prepend
  order — that's an implementation detail).
- Weekday derived from the same `Clock` convention as `dayKey`/`isoWeekKey` so the
  day-gate and the weekly budget agree on "today" (local system time, single-user V1).

### SW step — `publishApprovedThen(tabId)` in `src/service-worker/index.ts`

Slots into `launch()` **between** the Smart Connect step (line 154) and `startLoop()`
(line 155). Contract:

1. **Gate:** content module enabled (SW gatekeeper SSOT); today's weekday ∈ `publishDays`;
   `remainingPosts(week, postsPerWeek) > 0`; `pickOldestApproved(drafts)` is non-null.
   Any gate false → no-op, return `0`.
2. ⚠️ **Tab-readiness gate (same nav race that broke the last session).** This step runs
   right after `runConnectsThen`, which navigates the tab back to `/feed/` → a freshly
   re-injected content script. Sending `EXECUTE_ACTION` immediately can hit a not-yet-ready
   script ("receiving end does not exist") → silent skip. **Reuse the `navigateLinkedInTab`
   ready-gate** (`chrome.tabs.get` `status:'complete'` + `url.startsWith('…/feed/')`, *then*
   ping the new content script) — not a bare ping. If smart_connect is OFF there is no nav
   and the tab may not be on `/feed/` (the composer trigger only exists there) → navigate to
   `/feed/` through the same gate first.
3. **Publish:** take `pickOldestApproved` → drive the **existing** `executeComposerPost`
   adapter (`PUBLISH_POST`/`publishPost` primitive) wrapped in `withPageActivity(PUBLISHING)`.
4. **On success:** remove the draft + `recordPostWeek(budget, 1)` + write `postsPublished`
   into the autopilot state (mirrors `connectsExecuted`). Return `1`.
5. **One post per run** (anti-ban). This couples cadence to run frequency — acceptable given
   Mon/Wed/Fri + `postsPerWeek = 3`.
6. The whole step is wrapped in `try/catch` (like the connect step): a composer failure
   records a skip in the report and never aborts the engagement loop or leaves a
   phantom-running state.

### RunReport

`stopAutopilot` adds a `content` module line `{ id: 'content', executed: s.postsPublished,
skipped: 0, failed: 0 }` when `s.postsPublished` is set (mirrors the `smart_connect` line).

### Boundary test

`publishApprovedThen` step test: fake content-publish + fake `KeyValueStore` — asserts it
publishes the oldest approved draft only on a matching weekday with budget left, consumes
the draft, records the week, and is a no-op otherwise. Crosses the SW↔content publish
contract + the weekly-budget side-effects.

---

## Invariant #5 shift (record in architecture-overview)

Old: *"posts approve-first (never full-auto by default); posts never in a run."*
New: **posts are still approved by the human one-by-one (explicit «Одобрить» click) —
"approve-first" holds — but publishing of an already-approved post is a gated step inside
the run.** The human gate moves from "click publish" to "click approve"; the mechanical
publish is automated, capped by `publishDays` + `postsPerWeek`, one per run.

---

## Anti-ban / safety summary

- Only **approved** drafts publish (explicit per-post human gate).
- **One** post per run.
- Weekly cap (`postsPerWeek`) enforced via `PostWeekBudget`.
- Weekday gate (`publishDays`).
- Composer adapter already live-verified; tab-readiness gate prevents the nav race.

---

## Out of scope (Phase 1 trim)

- No time-of-day scheduling (only weekdays; time = whenever the bot runs that day).
- No separate alarm/scheduler.
- No multi-post-per-run batching.
- No backfill/migration of existing drafts (they stay un-approved).

---

## Files touched (anticipated)

- `src/lib/types.ts` — `Draft.approved?`, `IdeasLastRun`.
- `src/lib/content/DraftStore.ts` — `setApproved`.
- `src/lib/content/settings.ts` — `publishDays` (+ default, validation).
- `src/lib/content/publishPolicy.ts` *(new)* — `shouldPublishToday`, `pickOldestApproved`.
- `src/service-worker/contentHandlers.ts` — `ideas:lastRun` writes; (real-cause fix TBD by dump).
- `src/service-worker/index.ts` — `publishApprovedThen` step + RunReport `content` line.
- `src/sidepanel/composables/useContent.ts` — `approveDraft`, `lastRun` load.
- `src/sidepanel/screens/ContentScreen.vue` — approve button + badge + lastRun status line.
- `src/sidepanel/screens/SettingsScreen.vue` — weekday checkboxes.
