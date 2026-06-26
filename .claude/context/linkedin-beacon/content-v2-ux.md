# Content Pipeline v2 + UX pass — shipped 2026-06-26

## Files (content pipeline)
- core `src/lib/content/`: `DraftStore` (+`setApproved`) · `settings.ts` (`publishDays` default [1,3,5] +
  `sanitiseDays`: null→default, explicit []→"never") · `defaultPostPrompt.ts` (depersonalized storytelling
  framework, 400–800 chars — long prompt extracted per ≤300 rule) · `publishPolicy.ts`
  (`shouldPublishToday`, `pickOldestApproved` by createdAt) · `PostWeekBudget`.
- core `src/lib/ideas/`: `IdeaExtractor` (broadened to wide-audience angles, temp 0.7, NO maxTokens cap) ·
  `IdeaDayBudget` (owns `IDEA_BUDGET_KEY` + `IDEAS_LAST_RUN_KEY` — SSOT for both keys) · `IdeaBank`.
- SW `src/service-worker/`: `contentHandlers.ts` (`extractRunIdeas` writes `ideas:lastRun` every path +
  `MIN_IDEA_BUFFER=5` thin guard) · `contentHandlers.publish.ts` (`publishApprovedDrafts` only — publishPost
  chain DELETED as dead) · `index.ts` `publishApprovedThen(tabId)` step in `launch()` (prepare→navigateLinkedInTab
  ready-gate before composer; uncertain undefined→un-approve+record-week, no dup post).
- content `src/content/`: `index.ts` run-end catch-up ALWAYS extracts (IDEA_FLOOR dropped) ·
  `activityOverlay.ts` `countdownActivity(ms,label)` (live pill timer) · `statusLabels.ts` `breakCountdownLabel` (m:ss).
- UI: `ContentScreen.vue` (per-action pending: drafting/approving/copyState/savedDraft) ·
  `DashScreen.vue` (single «Запустить»↔«Остановить» toggle, worker-window removed) · `SettingsScreen.vue`
  (weekday checkboxes, master-save loading+✓) · `ModuleCard.vue`/`ModulesScreen.vue` (saved ✓) · `SafetyScreen.vue`.

## GOTCHAS (hard-won this session)
- **maxTokens cap = reasoning-model starvation (FAMILY bug, hit 2×).** gemini-3.5-flash spends the output
  budget on a reasoning phase BEFORE the content; ANY cap truncates. Bit IdeaExtractor (was 600) AND
  DraftGenerator (was 800 → post cut off mid-sentence). RULE: **no maxTokens cap on generators; bound length
  via the PROMPT.** CommentDraftService still caps 160 (short comments) — watch if it ever truncates.
- **Ideas-in-loop never fired ≠ budget.** Confirmed by LIVE chrome.storage dump (CDP, real profile): budget
  used:0, content enabled, key/expertise ok — cause was `IDEA_FLOOR=8` run-end gate (short runs <8 posts).
  Lesson: the `ideas:lastRun` diagnostic is the in-product "dump" — build the visibility, then a real run names the cause.
- **Per-action UI feedback:** never share ONE `generating`/loading ref across multiple buttons — the spinner
  lands on the WRONG button (Vlad: clicked «В черновик», state showed on the yellow «Сгенерировать» above).
  Key pending state per action/id (`drafting`/`approving`/`copyState`). Pattern reused everywhere.
- **Agent worktree base is STALE/inconsistent.** `Agent isolation:"worktree"` branched some agents from the
  SESSION-START commit, not current `main` (T6 re-implemented an already-merged type; T8 failed import). Same
  dispatch, different bases (one fresh, one stale). DON'T trust worktree to branch from live main → dependent
  tasks break. Do dependent tasks in the MAIN tree sequentially; recover uncommitted worktree work via patch.

## UX feedback patterns (reuse for new UI)
- Async button: pending text on ITSELF + `:disabled` (key per id for lists).
- Transient confirm: `<span class="v ok">… ✓</span>` cleared after ~1.5s (saves, copy, approve).
- Global press feel: `.btn`/`.ghost` `:hover`/`:active`/`:disabled` in styles.css.
- Live timer pill: `countdownActivity` (throttles in lockstep with real pacing — fine).
- Copy: «Скопировано ✓» / «Не вышло» on the button. Error = direction, action keeps its name through the flow.
