# Beacon — Progress (as of 2026-06-27, night)

`main` = working branch (direct-to-main). **All pushed to origin (HEAD `1923fb6`). Version `0.6.0`.**
**~393 tests green, `npm run build` clean.** MVP готов; pull-side просмотры профилей ЗАШИПЛЕНЫ.

## NORTH STAR
**Главная задача Beacon = поднимать SSI на МАКСИМУМ** (pull > push). SSI = 4 пиллара ×25.
Маппинг пиллар→модуль в `src/lib/ssi/weeklyGoal.ts`: insights→engagement, brand→content,
**people→profile_views** (research-fix: People = просмотры/searches, НЕ коннекты), relationships→smart_connect.
Версионирование на контроле: `docs/versioning.md` (фича=minor бамп в ритуале завершения).

## This session (2026-06-27) — SSI PULL SIDE: Profile Views SHIPPED + Audit screen (reader deferred) → v0.6.0
Research-FIRST (4 web-агента → LinkedIn Help a105145/a594698): подтверждено — исходящие просмотры профилей
растят People-пиллар; входящие просмотры = МИФ; Sales Navigator НЕ множитель (потолок free ~75). Research +
spec + plan в `docs/{research,superpowers/specs,superpowers/plans}/2026-06-26-ssi-pull*`.
- **⭐ Просмотр профилей (Feature A) — ПОЛНОСТЬЮ + LIVE-VERIFIED (2026-06-27, CDP, реальный аккаунт):**
  views-only смоук (лимит 4) → зашёл на 2 профиля рекрутёров, записал views:history/daily/seen-set; полный
  путь search→harvest→profile→dwell→persist работает. Модуль `profile_views` (default 40/день),
  шаг `runViewsThen` в «Запустить» ПЕРЕД connects, переиспользует таргет Smart Connect (SSOT), тот же анти-бан
  гейт (day-cap+jitter+human pace+seen-set dedup+ready-gate+overlay re-assert). Gate на viewsEnabled +
  empty-keywords guard (advisor). Карточка + Reports split + список. Core: `src/lib/views/` (ViewDayBudget,
  ViewHistory) + `viewHandlers.ts` (boundary-tested) + `executeProfileView` dwell + `DWELL_PROFILE` msg.
- **Аудит профиля (Feature B) — экран + чистая логика, НА ДЕМО (ридер отложен):** `auditProfile()` official
  All-Star 7 (hard, гейтят %) + best-practice (soft, честно НЕ official). Экран + навигация готовы, но
  **вход с Dash скрыт `AUDIT_ENTRY_ENABLED=false`** — наивный live-ридер давал ложные «у тебя нет X»
  (lazy-load + hashed-классы). API-recon: профильный метод = voyager graphql `voyagerIdentityDashProfiles.<hash>`,
  но хеш ротируется + секции = отдельные lazy-вызовы → нет стабильного одного endpoint. См. built-in memory
  `profile-reader-false-negatives`.
- Прочее: idea-bank newest-first (Vlad ask), `auto_apply` выпилен, бэклог Todoist почищен (50→25: убраны
  бэкенд-прокси/окно-воркер/human-mouse/Easy-Apply/монетизация/Note-эпик), версия 0.1.0→0.5.0→0.6.0.
- Final whole-branch review (opus): Ready to merge, no Critical/Important; fixed seen-set slice(-5000).

## NEXT TASK — Profile Audit REAL reader (Brand pillar, honest)
Todoist ⭐ переформулирован. Сделать реальное чтение профиля для аудита:
1. Источник: voyager API (`voyagerIdentityDashProfiles`, обработать ротацию хеша + lazy section-вызовы) ИЛИ
   DOM `/in/me/` scroll-to-load + точные селекторы текущего билда. Recon решит, где present-never-absent.
2. **Честное unknown-состояние:** `ProfileSnapshot` сейчас всё bool/number — добавить «не смог проверить»
   (tri-state или `unreadable: string[]`), НЕ показывать ложное «нет X». Boundary-тест на реальной форме.
3. PII-sanitize любой fixture (no urn/contact/csrf). Включить `AUDIT_ENTRY_ENABLED`, wire `loading` ref.
(Просмотры профилей уже live-verified — см. выше.)

## Prior session (2026-06-26) — Content Pipeline v2 SHIPPED + live-verified + UX pass
Built via brainstorm→spec→plan→subagent-TDD (12 tasks), then a long live-debug + UX round.
Spec/plan: `docs/superpowers/{specs,plans}/2026-06-26-content-pipeline-v2*`.
- **Ideas bug FIXED (root cause confirmed by LIVE STORAGE DUMP, NOT budget):** in-loop extraction
  never fired because run-end catch-up gated on `IDEA_FLOOR=8` (short runs buffered <8 → never
  extracted). Budget was fine (used:0). Fix: run-end ALWAYS extracts (drop IDEA_FLOOR) + anti-slop
  `MIN_IDEA_BUFFER=5` (thin buffer → records `ideas:lastRun=thin_feed`, no LLM call). `ideas:lastRun`
  written on EVERY extract path → surfaced on Content tab (no more silent "генерирую"→0).
- **Approve gate:** `Draft.approved`, «Одобрить»/«Отозвать» + badge (client-side), NOT gated by postsLeft.
- **Auto-publish:** `publishDays` (Пн/Ср/Пт default) + pure `publishPolicy` + `publishApprovedDrafts`
  (oldest approved, weekday+weekly-cap gated, prepare→tab-ready before composer) wired as a step in
  «Запустить». Uncertain publish (channel closed) → un-approve + record week (no duplicate public post).
  Invariant #5 reworded (human approves each; only mechanical publish automated).
- **Post-feedback tuning (Vlad live):** draft truncation fixed (dropped `maxTokens:800` in DraftGenerator —
  same reasoning-model family as ideas); `DEFAULT_POST_PROMPT` → own file `defaultPostPrompt.ts`,
  depersonalized storytelling framework 400–800 chars; `IdeaExtractor` broadened (career/human angles +
  light tech undertone, temp 0.4→0.7) — Vlad confirmed ideas now relatable, not dry.
- **UX pass (whole extension):** per-action button feedback (pending on the CLICKED button, not a shared
  flag), global `.btn`/`.ghost` press affordance, «сохранено ✓»/«Скопировано ✓» confirmations, Settings
  master-save loading+✓, Safety cancel/pause feedback. Dash: ONE «Запустить»↔«Остановить» accent toggle,
  removed worker-window option (always current tab). Live countdown on the on-page pill («Пауза 11с→…»,
  «Перерыв m:ss»). Dash autopilot copy now describes the full cycle across all enabled modules.

## Known limitations / debt
- `service-worker/index.ts` (~566, +views wiring) + `content/index.ts` > 300-line rule (pre-existing router
  debt; spec-anticipated extract `runSteps.ts` is OVERDUE — do as a dedicated refactor). Worker-window SW path
  unused (UI removed) — can be deleted.
- Profile Audit на ДЕМО-данных, вход скрыт (`AUDIT_ENTRY_ENABLED`) — реальный ридер = NEXT TASK.
- Combined-load watch: при обоих включённых модулях views+connects харвестят один people-search → больше
  search-страниц (потолок free commercial-use). Оба default off, деградация = пустой поиск (не бан).
- `weeklyGoal.ts` relationships lever says «персональный Note» but Smart Connect ships BARE invites — stale
  string (honesty fix queued in Todoist).
- Inbox screen still demo (real inbound = pull-loop, queued). No SSI history charts yet.
- Auto-publish live smoke (approve→run→1 post) not yet done end-to-end by Vlad (composer itself live-verified).

## Prior shipped (live-verified) — see git + architecture-overview
Phase 1 SSI · engagement (broad likes + auto-scroll + judged comments OFF-by-default) · Smart Connect
(people-search → bare connects, multi-region geoUrn) · Content Pipeline v1+v2.
