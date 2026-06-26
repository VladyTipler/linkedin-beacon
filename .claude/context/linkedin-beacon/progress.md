# Beacon — Progress (as of 2026-06-26, night)

`main` = working branch (direct-to-main). **All pushed to origin (HEAD `8618b6b`).**
**~390 tests green, `npm run build` clean.** MVP считается готовым (Vlad): чтение SSI + 3 рабочих
модуля в одной кнопке, live-проверены на его аккаунте.

## NORTH STAR (sharpened this session)
**Главная задача Beacon = поднимать SSI на МАКСИМУМ** (pull > push). SSI = 4 пиллара ×25.
Маппинг пиллар→модуль в `src/lib/ssi/weeklyGoal.ts`: insights→engagement, brand→content,
people→smart_connect, relationships→smart_connect.

## This session (2026-06-26) — Content Pipeline v2 SHIPPED + live-verified + UX pass
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

## NEXT TASK (Vlad's direction — next session, research-FIRST)
Goal = push SSI higher via the PULL side (the current gap). Build research-backed:
1. **SSI research (web, REAL facts):** what actually moves each of the 4 pillars; validate "do profile
   VIEWS affect SSI?" + Sales Navigator reality. Separate confirmed from myth.
2. **⭐ Profile audit (Brand):** read profile → completeness checklist (criteria grounded in the research,
   NOT invented) → what to fix.
3. **⭐ Profile-views step (People + pull):** visit N target profiles/day from search ("вы смотрели профиль"
   → inbound). Same anti-ban gate as Smart Connect. Only if research confirms SSI impact.
(Todoist actualized: 18 shipped tasks closed, 5 SSI-max added — incl. these + reply-to-commenters + Note-string fix.)

## Known limitations / debt
- `service-worker/index.ts` (~518) + `content/index.ts` (~387) > 300-line rule (pre-existing router debt;
  suggested extract `runSteps.ts`). Worker-window SW path now unused (UI removed) — can be deleted.
- `weeklyGoal.ts` relationships lever says «персональный Note» but Smart Connect ships BARE invites — stale
  string (honesty fix queued in Todoist).
- Inbox screen still demo (real inbound = pull-loop, queued). No SSI history charts yet.
- Auto-publish live smoke (approve→run→1 post) not yet done end-to-end by Vlad (composer itself live-verified).

## Prior shipped (live-verified) — see git + architecture-overview
Phase 1 SSI · engagement (broad likes + auto-scroll + judged comments OFF-by-default) · Smart Connect
(people-search → bare connects, multi-region geoUrn) · Content Pipeline v1+v2.
