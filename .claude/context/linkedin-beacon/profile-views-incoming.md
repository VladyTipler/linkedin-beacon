# Profile Views — INCOMING (WVMP metric) — shipped v0.8.0 (2026-07-02)

**«Кто смотрел ваш профиль»** — read-metric на дашборде (счётчик + дневные снапшоты + тренд рядом
с трендом SSI). LIVE-VERIFIED на аккаунте Влада (45 просмотров/90дн). НЕ путать с исходящим
модулем `src/lib/views/` (`views:*`, действие — заходим на чужие профили). Это INCOMING, `profileViews:*`.
Зеркалит SSI-движок истории (v0.7.0). Заменил отменённый эпик «Реальные Входящие» (инбокс-парсинг
переписки НЕ делаем — нативный мессенджер + бан-риск; меряем видимость, не переписку).

## Источник данных (заземлено на реальном дампе, CDP)
- **НЕТ чистого voyager-JSON для счётчика.** Число живёт ТОЛЬКО в SDUI/RSC-ответе:
  `POST https://www.linkedin.com/flagship-web/rsc-action/actions/server-request?sduiid=WvmpAnalytics`
  (фиксированное тело в `wvmpRequest.ts`, ~1283б). Рядом voyager-graphql отдаёт лишь профиль-заглушку.
- **Фоновый POST из service worker РАБОТАЕТ** (verified 200): `credentials:'include'` (HttpOnly-куки
  сам) + `csrf-token` = кука `JSESSIONID` (`ChromeCookieCsrfProvider`, тот же порт что у SSI). Без
  навигации по вкладкам — SSI-симметрия. Новый узкий порт `HttpPostText` (RSC = текст, не JSON).
- **Парсер** `parseWvmpRsc` (`wvmpParser.ts`): токенизирует все `"children":["…"]`, находит якорь
  `/profile viewers in the past (N) days/i`, берёт БЛИЖАЙШИЙ предшествующий pure-number токен → count.
  Дистракторы (179/176 = colour tokens, «4 recruiters», badge «3») отсеиваются. Возвращает null (не
  фейковый 0) если якоря нет. Проверен на полном 41КБ ответе — якорь встречается 1 раз.
- **Число = скользящее окно 90 дней** («Profile viewers in the past 90 days»). `windowDays` хранится
  в снапшоте. Имена вьюеров — Premium-gated, НАМ НЕ НУЖНЫ.
- **DOM-fallback ВЫРЕЗАН** (был `parseWvmpDom`): не подключался (нужна навигация на analytics-стр.),
  code-review флагнул как dead code. SDUI POST — единственный источник; при drift честный throw →
  метрика «unknown», а не врёт. Если понадобится fallback — только через content-навигацию.

## Файлы
- core `src/lib/profileViews/`: `wvmpParser.ts` (parseWvmpRsc) · `wvmpRequest.ts` (URL+тело) ·
  `WvmpApiClient.ts` (implements `SnapshotSource<ProfileViewsSnapshot>`) · `contracts.ts` (`HttpPostText`) ·
  `profileViewsProgress.ts` (`computeViewsProgress` — скалярный аналог `computeProgress`) ·
  `fixtures/wvmpFixtures.ts` (PII-санитизированный реальный RSC-срез, boundary-тест).
- storage `src/lib/storage/`: `ProfileViewsRepository.ts` (`profileViews:latest`/`:history`, cap 90) ·
  `fakeStore.ts` (общий тест-дабл, был ×4 копии).
- SW `service-worker/index.ts`: `viewsRefresher` (SnapshotRefreshService<T>, ключ
  `profileViews:lastRefreshAt`, независимый try/catch) + `handleViewsRefresh` + `refreshMetricsIfDue()`
  (оба метрика по одному триггеру, падают независимо). Message `PROFILE_VIEWS_SNAPSHOT`.
- UI: `ProfileViewsTrend.vue` (скалярный, счётчик виден с 1-го дня, спад НЕЙТРАЛЬНЫЙ) +
  `useProfileViews.ts` (зеркало useSsi) на `DashScreen` под «Просмотры профиля».

## Generic-переиспользование (DRY, задача требовала)
- `history/dailyHistory.ts`: `upsertDailySnapshot<T extends {capturedAt}>` (генерифицирован, SSI
  re-export через `ssi/ssiHistory`) + общий `daysBetween`/`DAY_MS`.
- `refresh/BackgroundRefreshService.ts`: `SnapshotRefreshService<T>` + `SnapshotSource<T>`;
  `BackgroundRefreshService` теперь тонкий shim `extends …<SsiSnapshot>` (SSI-сайты не тронуты).
- `sidepanel/lib/ssiTrendView.ts`: `sparklinePoints`/`deltaArrow`/`deltaLabel` + добавлены
  `pluralDays`/`daysLabel`/`spanLabel` (использованы в обоих виджетах).

## Грабли (высечено этой сессией)
- **`replace_all` съел строку ВНУТРИ helper'а** → `refreshMetricsIfDue()` звал сам себя = бесконечная
  рекурсия → stack overflow убивал ВСЕ авто-рефреши (onInstalled/alarm/panel-open). FORCE_REFRESH
  работал в обход → первый live-verify это ЗАМАСКИРОВАЛ. Урок: live-verify гонять именно тот путь,
  что чинишь (авто-путь через REQUEST_REFRESH, не только FORCE_REFRESH). Поймал xhigh code-review.
- **useSsi/useProfileViews теряли историю при маунте**: `apply(last)` при `isReal=false` сворачивал
  в `[]`, затирая только что загруженный `hist`. Фикс: `isReal=true` ДО `apply`. Баг был и в
  shipped `useSsi` — починил оба.
- **Честность**: демо-данные внутри расширения показывались как реальные (isReal не пробрасывался).
  Теперь `isReal` → лейбл «Демо-данные». Как SSI-гейдж (`isReal ? 'Твой индекс' : 'Демо-данные'`).
- **Live-verify механика**: расширение mcaopdff idle-выгружает SW; после `chrome.runtime.reload()`
  панель НЕ переоткрывается. Решение: открывать sidepanel-страницу вкладкой через browser-level CDP
  `Target.createTarget(chrome-extension://…/src/sidepanel/index.html)` — полный extension-контекст
  (chrome.storage/runtime/cookies), драйвить оттуда, закрыть `Target.closeTarget`. Не через панель.

Related: [[profile-views]] (исходящий), [[architecture-overview]], [[cdp-nav-artefacts]], [[gotchas]].
