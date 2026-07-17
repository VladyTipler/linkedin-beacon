# India-exclusion фильтр — дизайн УТВЕРЖДЁН, не построен (для новой сессии)

Влад: «очень много индийских рекрутеров набирает расширение, хочу исключить Индию». Дизайн согласован 2026-07-16, реализацию отложили. **Начать с этого файла — не переизобретать.**

## Ключевая DOM-находка (load-bearing)
**PYMK-карточки НЕ содержат локацию** (только имя + хедлайн; проверено live). People-search карточки локацию содержат. Значит:
- Чистое гео-исключение на PYMK (основной источник) **невозможно** по карточке.
- **Фильтр по keyword (headline)** — рабочая лошадка: индийские IT-стаффинг рекрутеры палятся по хедлайну (`bench sales`, `C2C`, `corp to corp`, `US IT recruiter`, `US staffing`). Работает на обоих источниках.
- Города Индии — только на search-карточках (где локация парсится).
- **По именам НЕ фильтровать** (этническое профилирование — против планки [[public-reputation-app]]).

## Решения Влада (утверждены)
1. **Конфиг:** пресет-тумблер «Исключить Индию» (бандл: india + города + bench sales/C2C/corp-to-corp) + поле кастом-стоп-слов.
2. **Scope:** Коннекты + Просмотры (общий фильтр).

## Дизайн (фаза 1)
1. `connect:settings` += `excludeIndia: boolean` + `excludeKeywords: string[]`.
2. `src/lib/connect/exclusion.ts` (pure, 100% unit-tested):
   - `INDIA_KEYWORDS` = страна+города (india, bengaluru/bangalore, mumbai, delhi, hyderabad, chennai, pune, gurugram, noida, kolkata, ahmedabad) + role-tells (`bench sales`, `corp to corp`, `corp-to-corp`, `c2c`, `us it recruiter`, `us staffing`).
   - `resolveExcludeKeywords(settings)` = (excludeIndia ? INDIA_KEYWORDS : []) + custom, lowercase.
   - `isExcluded(candidate, keywords)` = стоп-слово встречается в `(headline + ' ' + location)`.toLowerCase().
   - `filterExcluded(candidates, keywords)`.
3. `harvestPeople`/`harvestProfiles` (harvestPeople.ts): извлечь **best-effort `location`** (текстовая строка локации на карточке; на PYMK пусто) → `PersonCandidate.location?`.
4. Применение: фильтр после харвеста ПЕРЕД `selectCandidates` — в `runConnectStep` и `runViewStep` (оба зовут selectCandidates). Загрузить excludeKeywords из settings в шаге.
5. **Search geoUrn:** при `excludeIndia` выкинуть India-geoUrn `102713980` из `geoUrnsForRegions(...)` при построении search-URL (root cause: перестать кормить → PYMK со временем расскосится, т.к. зеркалит активность).
6. UI: карточка «Коннекты» — тумблер «Исключить Индию» + мелкое поле кастом-стоп-слов. 1:1 с эталоном.

**Честно про охват:** headline-термины ловят надёжно на обоих; города — только где локация парсится. Идеального гео-PYMK нет (нет локации). Связка «убрать India из поиска + keyword-фильтр + де-скью PYMK» практически решает.

## Фаза 2 (отложена — идея Влада)
«Открыть профиль → прочитать страну → фильтровать». Даёт надёжную страну для PYMK, НО конфликтует с card-based direct-send коннектом (уход на профиль убивает карточку) → нужен **profile-based connect** (перестройка флоу + recon кнопки Connect на профиле) ИЛИ дорогой two-pass. Бо́льшая фича. Делать ТОЛЬКО если card-фильтр фазы 1 не хватит.

## TDD
Unit: `resolveExcludeKeywords`/`isExcluded`/`filterExcluded` (India-пресет + кастом; матч по headline И location; bench-sales ловится, «David De Graeve» не ловится). Boundary: harvestPeople извлекает location из реального search-card HTML. Live-verify: прогон не набирает индийцев.

Related: [[ssi-guide-roadmap]], [[smart-connect]], [[connect-search-ceiling-and-pymk]], [[public-reputation-app]].
