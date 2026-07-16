# PYMK deep pool — Show-all + верный скроллер (2026-07-16)

## Симптом
v0.9.0 PYMK-fallback давал ~8 коннектов/прогон, а сразу после прогона — **2** (инлайн истощён Pending'ами). Влад хочет 10-15/прогон + Views тоже под лимитом поиска.

## Улики (live CDP, 2026-07-16)
- PYMK-инлайн `/mynetwork/grow/`: **8 connectable**.
- Клик по ТОЧНОМУ recent-activity Show-all (`a/button[aria-label*="you may know based on your recent activity"]`, содержит «Show all suggestions for People you may know based on your recent activity») → **44 connectable**, URL тот же (разворот на месте).
- Скролл ВЕРНОГО контейнера (внутренний overflow-ancestor connect-кнопки, `overflowY:auto/scroll` — как `feedScroller`), НЕ `document.scrollingElement` → **92+** (infinite scroll).

## Корень «2 сегодня» = БАГ КОДА
`pymkScrollHarvest` (content HARVEST_PYMK) скроллит `document.scrollingElement ?? documentElement` — **не тот элемент**: PYMK-лист живёт во внутреннем overflow-контейнере → scroll = **no-op** → берётся только начальный инлайн ~8. Плюс Show-all не жмётся. → после прогона инлайн = Pending → fresh 2. Тот же класс, что старый баг скроллера ленты (feedScroller чинил ровно это).

## Фикс (evidence-based)
1. **Expand:** перед харвестом кликнуть recent-activity Show-all (8→44). Graceful: не нашёл → инлайн.
2. **Correct scroller:** pymkScrollHarvest скроллит внутренний overflow-контейнер (паттерн feedScroller: ancestor connect-кнопки с overflowY auto/scroll), не window → 44→92+.
Итог: 8 → 92+ доступных connectable. 10-15/прогон достижимо; dedup не потолок (вчера 8/8 fresh, буфер 92+).

## Заметки
- Инлайн PYMK **скрывает Pending** (0 pending намерено) → harvestProfiles на PYMK ≈ те же connectable, НЕ больше (advisor). Для Views пул ≈ тот же deep-пул.
- Устойчивость: дневной cap ~14 < буфер 92+ → PYMK держит cap какое-то время; регенерит часами. Лимит ПОИСКА сбрасывается ~месяц (тогда поиск вернёт настоящий объём).

Related: [[connect-search-ceiling-and-pymk]], [[connect-pool-saturation-bug]].
