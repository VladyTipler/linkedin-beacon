# PYMK deep-pool harvest + Views PYMK-fallback — Design

**Дата:** 2026-07-16 · **Статус:** утверждён (Влад) · **Фаза:** 1 · **Мишень:** v0.10.0

## Проблема
1. **Connect объём:** v0.9.0 PYMK-fallback берёт только ~8 (инлайн), после прогона → 2 (инлайн истощён Pending). Влад хочет 10-15/прогон.
2. **Views под лимитом:** Profile Views ходят через тот же people-search → тоже упёрлись в commercial-use лимит. Нужен PYMK-fallback и для Views.

## Корень объёма (live-verified, memory-bank `pymk-deep-pool`)
`pymkScrollHarvest` скроллит `document.scrollingElement` — **не тот элемент** (PYMK-лист во внутреннем overflow-контейнере) → scroll = no-op → берётся только инлайн ~8. И Show-all не жмётся. Живьём: инлайн **8** → recent-activity Show-all **44** → скролл верного контейнера **92+**.

## Решение

### Part A — Глубокий PYMK-пул (чинит объём connect + питает Views)
Content-харвест PYMK (перед scroll-harvest):
1. **Expand:** кликнуть recent-activity Show-all — `a/button` с `aria-label` содержащим `you may know based on your recent activity`. Раскрывает 8→44 на том же URL. Graceful: не найден → инлайн (деградация, не поломка).
2. **Correct scroller:** scroll-harvest скроллит **внутренний overflow-контейнер** (ancestor connect-карточки с `overflowY: auto|scroll`, паттерн `feedScroller` из content/index.ts), НЕ `document.scrollingElement`. → 44→92+.
Применяется к обоим PYMK-харвестам (connectable для connect, all-members для views).

### Part B — Views PYMK-fallback (top-up при недоборе)
Зеркало `runConnectWithFallback`. `runViewStep` УЖЕ источник-агностичен (принимает `searchUrl`/`harvestPage`/`nextPage`, keyword-гейт снаружи, reason `pool_dry` при недоборе / `done` при заполнении cap) — **менять не нужно**.

`runViewWithFallback(deps)` (новый, в `viewHandlers.ts`):
1. search-проход = `runViewStep` с people-search URL + paginated harvestProfiles.
2. Если `reason ∈ {disabled, budget, cancelled, done}` → вернуть search (done = cap заполнен, топить нечего).
3. Иначе (pool_dry / недобор / nav-фейл / no_keywords) → PYMK-проход = `runViewStep` с `searchUrl=PYMK_URL`, `harvestPage=` PYMK-scroll-профилей (single-shot, все members), `nextPage=()=>false`. Топит остаток cap (перечитывает бюджет — SSOT).
4. Combine: `executed = search+pymk`; reason = pymk дал → `done`; иначе search дал → его reason; иначе pymk reason.

`runViewsThen` (SW): keyword-гейт → если ключи есть, search-проход; при недоборе/без-ключей → PYMK-проход. Без ключей → сразу PYMK (прецедент connect: no_keywords→PYMK, решение Влада).

### Messaging
- `HARVEST_PYMK` расширить флагом `{ profiles?: boolean }`: `profiles=true` → `harvestProfiles` (all members, для Views); иначе `harvestPeople` (connectable, для connect). Оба — с expand + correct scroller.
- SW: `harvestPymkProfilesFrom(tabId, target)` (профили для views), рядом с `harvestPymkFrom`.

## SSOT / общий бюджет
Views: PYMK-проход перечитывает view-бюджет → остаток cap (search+PYMK суммарно ≤ дневной лимит). Общий `views:seen`/history. Connect — как в v0.9.0.

## TDD
- **Unit** `runViewWithFallback`: search недобор (pool_dry) → PYMK зовётся; search `done` (cap заполнен) → PYMK НЕ зовётся; disabled/budget/cancelled → нет PYMK; combine executed/reason. (Зеркало fallback-тестов connect.)
- **Unit** content expand+scroller: `expandPymkShowAll` находит/жмёт по aria-label (jsdom); scroller-finder выбирает overflow-ancestor.
- **Boundary** `harvestProfiles` по PYMK-фикстуру (button-контрол уже покрыт; профили — тем же componentkey).
- **Live-verify:** реальный прогон — connect добирает из deep-PYMK (10-15), Views топят из PYMK; на залимиченном аккаунте.

## Вне scope
- Другие PYMK-когорты («X's connections you may know») — берём только recent-activity (её Show-all даёт 92+, хватает).
- Регенерация/устойчивость день-в-день — deep-пул 92+ буфер; лимит поиска сбросится ~месяц.

## Связанное
memory-bank: `pymk-deep-pool`, `connect-search-ceiling-and-pymk`, `connect-pool-saturation-bug`, `smart-connect`.
