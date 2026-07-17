# Грабль — LinkedIn лениво-грузит списки через ВНУТРЕННИЙ overflow-контейнер, не window (2026-07-17)

## Паттерн (повторился ТРИЖДЫ)
Любой длинный лениво-подгружаемый список LinkedIn скроллит **внутренний контейнер с `overflowY: auto|scroll`**, а НЕ окно. `document.scrollingElement.scrollTop = scrollHeight` = **no-op** → грузится только начальный экран → «берётся только верхушка».

- **Лента** (2026-06): `feedScroller()` — fix.
- **PYMK** `/mynetwork/grow/` (2026-07-16, v0.10.0): `pymkScroller()` — брал только инлайн ~8 вместо 92+.
- **Sent-инвайты** `/mynetwork/invitation-manager/sent/` (2026-07-17, v0.11.0): `sentScroller()` — грузил только верхние ~20 (свежие) → Отозвано 0 при 126 висяках.

**Решение (одинаковое):** walk-up от якорной карточки до предка с `scrollHeight > clientHeight + N` и `overflowY: auto|scroll`; скроллить ЕГО. Fallback на `document.scrollingElement`. Три копии (`feedScroller`/`pymkScroller`/`sentScroller`) — кандидат на DRY-обобщение `overflowScroller(anchor)`.

**Проверка нового списочного экрана LinkedIn:** ВСЕГДА проверяй `foundInnerScroller` (walk-up) + `windowAlsoScrolls=false` через CDP ДО того, как писать scroll-harvest. Иначе by default возьмёшь только верхушку.

## Второй грабль той же фичи: модалка в light DOM БЕЗ role=dialog
Withdraw-confirm — `<button aria-label="Withdraw invitation sent to <name>">` в **light DOM, но без `[role="dialog"]`-обёртки** (просто `<div>`). Селектор `[role="dialog"] button[...]` находил NOTHING → отзывалось 0. Row-контрол — `<a>`, confirm — `<button>`, так что `button[aria-label^="Withdraw invitation sent to "]` (+ точный матч имени) ловит только confirm. **Не предполагай `role="dialog"` — проверяй ancestor живьём.**

## Мета-урок (verify-the-fixed-path, высечено ещё раз)
Я дважды «верифицировал» withdraw и оба раза ошибся: (1) юниты зелёные + отчёт «отозвано 0» → решил «нечего отзывать» (а это был dead autopilotRunning-гейт), (2) CDP-проверка «нет ≥2нед» → но я сам недоскроллил тем же `document.scrollingElement`. **Влад поправил: «там динамическая подгрузка, есть >2нед».** Урок: при live-verify списочного DOM — скролль ВЕРНЫЙ контейнер, и если результат «пусто», сначала подозревай свой скролл/селектор, а не «данных нет».

Related: [[connect-pool-saturation-bug]], [[pymk-deep-pool]], [[verify-the-fixed-path]], [[gotchas]].
