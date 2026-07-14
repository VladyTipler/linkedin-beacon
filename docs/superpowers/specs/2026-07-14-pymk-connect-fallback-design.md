# PYMK-fallback для Smart Connect — Design

**Дата:** 2026-07-14 · **Статус:** утверждён (Влад, 2026-07-14) · **Фаза:** 1

## Проблема

Smart Connect берёт людей из people-search. У Влада этот путь упёрся в потолок LinkedIn:
- **Commercial-use search limit (CUL)** — месячный лимит поиска людей на free-аккаунте. При упоре поиск ОБРЕЗАЕТ выдачу (~3 результата вместо 10) и блокирует пагинацию. Явного баннера нет.
- **Сатурация пула** — 158 инвайтов отправлено; верхушка выдачи «recruiter» = сплошь Pending.

Итог: прогон даёт `Коннекты 0`. Диагноз подтверждён живым SW-трейсом + CDP (см. memory-bank `connect-search-ceiling-and-pymk.md`).

## Решение

Когда people-search коннект даёт **0** (по ЛЮБОЙ причине), автоматически добираем остаток бюджета коннектов из **PYMK** («People you may know», `/mynetwork/grow/`) — другая поверхность LinkedIn, НЕ под search-лимитом, свежий курируемый пул (и разработчики, и рекрутеры).

**Решения (утверждены):**
- **Триггер:** любой 0-результат поиск-коннекта (не хрупкий детект лимита).
- **Конфиг:** нет. Автоматически, встроено в модуль «Коннекты» (честно к one-button / минимум тумблеров).
- **Источник V1:** inline-скролл `/mynetwork/grow/`. Модалка «Show All» — расширение глубины, если inline мало (не в V1).

## Архитектура

### Поток (`runConnectsThen`, service-worker/index.ts)
1. **Search-фаза** — как сейчас: navigate people-search → harvest по страницам → connect до cap. Включает готовый honest-reason фикс (пагинация сквозь all-Pending + `pool_pending`) — сворачивается в эту работу.
2. **PYMK-фаза** — если `search.executed === 0` **и** бюджет ещё есть:
   - navigate `/mynetwork/grow/`
   - harvest connectable из PYMK (scroll-to-load)
   - connect до ОСТАТКА cap, тот же pace/gate/бюджет/история.
3. **Отчёт** — честно называет источник (коннекты из PYMK / оба источника пусты).

### Переиспользование harvest (ключевое из live-recon)
PYMK-карточки структурно идентичны people-search, **кроме Connect-контрола: `button`, а не `a`.** Всё остальное то же:
- componentkey `ConnectButtonstate:invitation:urn:li:member:<id>_connect`
- aria `«Invite <name> to connect»`
- профиль `a[href*="/in/"]`, имя/хедлайн в тексте карточки

→ Обобщить селектор `harvestPeople`: `a[aria-label…]` → tag-agnostic `[aria-label^="Invite "][aria-label$=" to connect"]` (ловит `a` И `button`). **sent-set совместим** (тот же memberId).

### Общий бюджет/гейт/sent-set (SSOT)
PYMK-коннекты жрут ТОТ ЖЕ weekly/daily connect-budget, тот же human-pace, пишутся в тот же `connects:sent` + `ConnectHistory`. Cap считается один раз и бьёт **суммарно** (search + PYMK). Никакого второго счётчика.

### Отличия PYMK-поверхности (заложить в реализацию)
- **Скролл-подгрузка** (infinite scroll), НЕ клик-пагинатор `button[aria-label^="Page "]`. Harvest PYMK = scroll-to-load (как `scrollHarvest` ленты), отдельный content-хендлер (напр. `HARVEST_PYMK_PAGE` / `PYMK_SCROLL`).
- **Навигация** `/mynetwork/grow/` (не people-search URL). Нет ключей/geoUrn — PYMK без таргета.
- **executeConnect на PYMK** (recon при реализации): клик `button` шлёт сразу или открывает тот же shadow-модал «Send without a note»? Если модал — переиспользуем существующий `executeConnect`; если direct — короткий путь.

### Абстракция источника
`runConnectStep` уже принимает инъекции `navigate/harvest/nextPage`. PYMK-фаза = второй проход той же connect-логики с PYMK-deps (navigate→/mynetwork/, harvest→PYMK-scroll-harvest, «nextPage»→scroll-more/false). Бюджет разделяется естественно: второй проход перечитывает уже обновлённый day/week budget → корректный остаток cap. Нюанс: search-фаза гейтит на `searchKeywords`; PYMK-фаза ключи НЕ требует → параметризовать «источник» так, чтобы PYMK-проход пропускал keyword-гейт.

## Отчёт / reasons
- PYMK дал коннекты → `done` (+ пометка источника PYMK в отчёте).
- Search 0 И PYMK 0 → честная причина (напр. `pymk_none` / оставить `pool_pending` с пометкой «PYMK тоже пуст»).
- Метки в `reasonLabels.ts` + тест.

## TDD
- **Unit** `harvestPeople` обобщённый селектор — boundary-тест: PYMK-фикстур (button) + people-search-фикстур (anchor), оба парсятся; Pending/Follow скипаются.
- **Unit** `runConnectsThen` fallback: search=0 → PYMK-фаза зовётся → коннекты из PYMK; search>0 → PYMK НЕ зовётся; суммарно executed ≤ cap; общий sent-set.
- **Boundary** PYMK harvest по РЕАЛЬНОМУ сохранённому HTML `/mynetwork/grow/` (PII-sanitize).
- **Content** scroll-harvest PYMK: мок скролл-контейнера, подгрузка карточек.

## Success criteria
Когда people-search залимичен/исчерпан (0 коннектов), прогон всё равно добирает людей из PYMK до бюджета. **Live-verified** на реальном аккаунте (когда позволит состояние; коннекты отзываемы).

## Вне scope V1
- Модалка «Show All» как источник (V2, если inline мало).
- Детект самого CUL-лимита / отдельная причина `search_limited` (не нужно — триггер = 0-результат).
- Таргетинг/фильтр PYMK по роли (берём всех suggested — Влад хочет и devs, и recruiters).
- Галочка/конфиг (решено: без неё).

## Связанное
memory-bank: `connect-search-ceiling-and-pymk.md` (диагноз + PYMK DOM-anchors), `connect-pool-saturation-bug.md` (honest-reason фикс, сворачивается сюда), `smart-connect.md`.
