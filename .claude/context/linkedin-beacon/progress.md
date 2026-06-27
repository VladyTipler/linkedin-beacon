# Beacon — Progress (as of 2026-06-27, late evening)

`main` = working branch (direct-to-main). **HEAD `fc922d2` (NOT yet pushed). Version `0.6.0`.**
**~426 tests green, `npm run build` clean.** MVP готов; pull-side просмотры профилей ЗАШИПЛЕНЫ.

## This session (2026-06-27, evening) — connect per-page fix + Dash live widget + comments rework
3 коммита в `main` (direct-to-main), ~426 тестов зелёные. Bug-hunt Vlad'а "бот не добавляет в сеть":
- **`aa78a8e` fix(connect): per-page connect + reliable STOP + run-outcome visibility.** Корень 0-инвайтов =
  `connect_anchor_not_found`: harvest собирал людей со ВСЕХ страниц пагинации, а executeConnect кликал якорь
  на ТЕКУЩЕЙ (последней) — якорей кандидатов с ранних страниц в DOM нет. FIX: **connect per-page**
  (`HARVEST_PEOPLE_PAGE` + `PEOPLE_NEXT_PAGE`) — собрал текущую → отправил → следующая. Плюс: STOP реально
  прерывает (PING-warmup + retry + `isRunning()` между шагами + `isCancelled` в for-loop), pace перенесён в
  content (`SLEEP` → SW не evict'ится + пилюля countdown), orphan-loop kill при старте, hideActivity в finally,
  harvest `{candidates,outcome}` ok/empty/not_ready (sentinel "No results found"), run-report per-module reason
  (`runOutcomes` + `reasonLabels`), `navigateLinkedInTab`→boolean. Идеи на русском (посты EN), ideas/day 5→10.
- **`2d57f51` feat(ui): live autopilot stage + today's action tally in Dash.** `AUTOPILOT_STAGE` broadcast из SW
  на каждом шаге → панель показывает реальный этап вместо хардкода «статус — на ленте». `useDayStats` — счётчики
  дня (просмотры/коннекты/лайки/комменты/идеи/посты) из daily budgets. Dash-виджет: пульсирующая lime-точка +
  этап + mono 3×2 tally grid (нули приглушённы). frontend-design pass.
- **`fc922d2` feat(comments): engage any liked post with a clarifying question.** SSI = feed activity, не узкий
  стек. Убран relevance-gate (`RelevanceScorer`/`COMMENT_THRESHOLD 0.5`) — комментим любой лайкнутый пост
  (LikeFilter уже отсёк мусор). Промпт → ONE clarifying QUESTION по теме поста. Убран `maxTokens:160` (reasoning
  family). `CommentJudge` оставлен (anti-slop). `rollComment(rng, 1/3)` — ~1/3 лайкнутых, распределено, не
  first-N; `commentsPerDay` cap.
- **LIVE-VERIFIED (CDP, real account, 2026-06-27):** connect per-page отправляет инвайты end-to-end (trace:
  page0 6/6 ok, page1 2 fresh ok). Comments/comments-rework + Dash widget — НЕ ещё live-verified Vlad'ом (ждёт
  полный прогон). Корни всех багов + process-урок (debug by SW CDP trace) — см. `gotchas.md` новые секции.

## NORTH STAR
**Главная задача Beacon = поднимать SSI на МАКСИМУМ** (pull > push). SSI = 4 пиллара ×25.
Маппинг пиллар→модуль в `src/lib/ssi/weeklyGoal.ts`: insights→engagement, brand→content,
**people→profile_views** (research-fix: People = просмотры/searches, НЕ коннекты), relationships→smart_connect.
Версионирование на контроле: `docs/versioning.md` (фича=minor бамп в ритуале завершения).

## Earlier (2026-06-27 night) — SSI PULL SIDE: Profile Views SHIPPED + Audit screen (reader deferred) → v0.6.0
Research-FIRST (LinkedIn Help a105145/a594698): исходящие просмотры профилей растят People-пиллар; входящие =
МИФ; Sales Navigator НЕ множитель (потолок free ~75).
- **⭐ Просмотр профилей (Feature A) — ПОЛНОСТЬЮ + LIVE-VERIFIED:** views-only смоук → зашёл на 2 профиля
  рекрутёров, полный путь search→harvest→profile→dwell→persist. Модуль `profile_views` (default 40/день),
  шаг `runViewsThen` ПЕРЕД connects, переиспользует таргет Smart Connect (SSOT). Core `src/lib/views/` +
  `viewHandlers.ts` + `executeProfileView` dwell + `DWELL_PROFILE`.
- **Аудит профиля (Feature B) — экран + чистая логика, НА ДЕМО (ридер отложен):** `auditProfile()` (official 7
  hard + best-practice soft). Вход скрыт `AUDIT_ENTRY_ENABLED=false` (наивный ридер давал ложные «нет X»).
- Прочее: idea-bank newest-first, `auto_apply` выпилен, бэклог Todoist почищен, версия 0.1.0→0.5.0→0.6.0.

## NEXT TASK — Profile Audit REAL reader (Brand pillar, honest)
Todoist ⭐ переформулирован. Сделать реальное чтение профиля для аудита:
1. Источник: voyager API (`voyagerIdentityDashProfiles`, обработать ротацию хеша + lazy section-вызовы) ИЛИ
   DOM `/in/me/` scroll-to-load + точные селекторы текущего билда.
2. **Честное unknown-состояние:** `ProfileSnapshot` → tri-state / `unreadable: string[]`, НЕ ложное «нет X».
3. PII-sanitize fixture. Включить `AUDIT_ENTRY_ENABLED`, wire `loading` ref.

## Prior session (2026-06-26) — Content Pipeline v2 SHIPPED + live-verified + UX pass
- **Ideas bug FIXED:** in-loop extraction never fired (run-end gated on `IDEA_FLOOR=8`). Fix: run-end ALWAYS
  extracts + `MIN_IDEA_BUFFER=5` thin guard. `ideas:lastRun` written every path.
- **Approve gate:** `Draft.approved`, «Одобрить»/«Отозвать» + badge.
- **Auto-publish:** `publishDays` (Пн/Ср/Пт) + `publishPolicy` + `publishApprovedDrafts` (oldest approved,
  weekday+weekly-cap gated). Uncertain publish → un-approve + record week.
- **Post-feedback tuning:** dropped `maxTokens:800` (DraftGenerator), `DEFAULT_POST_PROMPT` → own file,
  IdeaExtractor broadened. UX pass: per-action button feedback, countdown pill.

## Known limitations / debt
- `service-worker/index.ts` + `content/index.ts` > 300-line rule (pre-existing router debt; extract `runSteps.ts`
  OVERDUE). Worker-window SW path unused — can be deleted.
- Profile Audit на ДЕМО, вход скрыт (`AUDIT_ENTRY_ENABLED`) — реальный ридер = NEXT TASK.
- Comments rework + Dash widget — pending Vlad's full live smoke.
- `weeklyGoal.ts` relationships lever says «персональный Note» but Smart Connect ships BARE invites — stale.
- Inbox screen still demo. No SSI history charts yet. Auto-publish end-to-end smoke not yet done by Vlad.

## Prior shipped (live-verified) — see git + architecture-overview
Phase 1 SSI · engagement (broad likes + auto-scroll + judged comments) · Smart Connect (people-search → bare
connects, multi-region geoUrn) · Content Pipeline v1+v2 · Profile Views.
