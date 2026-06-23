# Phase 2 — Engagement module (feed) · executable plan

> Source of truth (tasks): Todoist project **LinkedIn Beacon** → section "Фаза 2 — Модуль вовлечённости (лента)".
> Spec: https://artifacts.kanev.space/beacon-design-spec/ (v0.4) — §4.1, §4.3.1, §5, §10.
> Design reference (pixel-target): docs/design-reference.html.
> Methodology: Spec → Plan → TDD. Tests precede implementation. SOLID throughout.

## Scope (Todoist Фаза 2 — 6 parent tasks)

1. Чтение ленты: content_script + FeedPost/FeedReader + DOM-стратегия + dedup (DOM-фикстура).
2. Умные лайки: скоринг релевантности + дневной бюджет/задержки + dedup + человекоподобный клик.
3. AI-комменты: генерация (LlmProvider) + judge-фильтр + человекоподобная вставка.
4. automationLevel per-module → гейт реальных действий (manual/auto_guardrails/full_auto).
5. Карантин: отложенная отправка с окном отмены (chrome.alarms + персист).
6. feedHarvest → ideaExtraction → банк идей (анти-AI-slop: лента = сигнал тем, не образец).

> Smart Connect, accept-rate floor, kill-switch, mouse-utils, окно-воркер — это Todoist **Фаза 3**, не здесь.

## Продуктовые инварианты (нарушать нельзя)

- **Чтение метрик — internal API. Действия (like/comment) — через DOM** человекоподобно (анти-бан).
- **Любое действие проходит через гейт** (automationLevel + бюджет + карантин) — с первого коммита, без негейченных путей.
- `automationLevel` per-module, дефолт **manual**. Высокий риск (коммент) — карантин в guardrails.
- Лента питает **первый** шаг идей (сигнал тем), а не последний (готовый текст). Эхо ленты = AI-slop.
- LLM за портом `LlmProvider`; ключи/прокси — отдельная инфра-задача, НЕ Фаза 2. Тесты на фейк-LLM, без сети.

## SOLID / порты

- Чистое ядро в `src/lib/*`, co-located `.test.ts`. Адаптеры в `src/adapters/` трогают chrome/document.
- Новый порт **`Rng`** (`next(): number` 0..1) — инъекция случайности (задержки/джиттер), детерминизм в тестах (аналог `Clock`).
- Порт **`FeedReader`** (DOM ленты), порт **`AlarmScheduler`** (chrome.alarms) для карантина.
- Гейт — OCP: набор `ActionGuard` (бюджет, dedup, judge…), Phase 3 добавит work-hours/risk без правки гейта.

## Порядок сборки (red→green→refactor, фундамент раньше действий)

**Блок A — чистое ядро (без DOM, без сети) — автономно:**
1. `lib/types.ts` extend: `ActionType`, `ActionRequest`, `ActionQueueItem`, статусы, `EngagementBudgetConfig`. Порт `Rng`.
2. `lib/engagement/RelevanceScorer.ts` — скоринг поста (экспертиза × тема). Pure.
3. `lib/engagement/LikeBudget.ts` — дневной бюджет + reset по дню (Clock). Pure.
4. `lib/engagement/HumanDelay.ts` — рандомная задержка из диапазона (Rng). Pure.
5. `lib/engagement/CommentDraftService.ts` — промпт из поста+экспертизы → LlmProvider. Fake-LLM tests.
6. `lib/engagement/CommentJudge.ts` — confidence/стоп-слова/длина. Pure.
7. `lib/gate/ActionGate.ts` — manual→queue, guardrails→judge+quarantine, full→execute. Pure (решение, не исполнение).
8. `lib/gate/QuarantineQueue.ts` — таймер N мин + отмена, персист. Clock + AlarmScheduler port + store.
9. `lib/ideas/IdeaExtractor.ts` — FeedItem[] → топики×углы через LlmProvider. Fake-LLM tests.
10. `lib/ideas/IdeaBank.ts` — персист банка идей. Fake store.
11. `lib/humanize/*` — генерация траектории/джиттера/задержек печати (Rng). Pure ядро (dispatch — в Блоке B).

**Блок B — DOM-зависимое (живой LinkedIn, один проход капчуры) — handshake:**
- `manifest`: content_script на `/feed/*` + MutationObserver готовности ленты.
- `lib/feed/FeedReader` + `adapters/DomFeedSource` + DOM-стратегия поста на **реальной фикстуре** (snapshot из живой сессии).
- dedup по urn; тесты парсера на фикстуре.
- `adapters/DomLikeAction` — человекоподобный клик Like (реальные mouse-события).
- `adapters/DomCommentAction` — открыть box, печать с задержками, отправка.

**Блок C — разводка + UI:**
- `service-worker`: оркестрация like/comment → ActionGate → QuarantineQueue → исполнение в content.
- UI: селектор automationLevel в ModuleCard ↔ реальное поведение; экран/баннер карантина + кнопка отмены.
- manifest permissions (notifications?). `npx vitest run` + `npm run build` зелёные.

## Test plan (acceptance)

- `RelevanceScorer.test.ts` — релевантность растёт с совпадением стека/темы/роли; порог.
- `LikeBudget.test.ts` — лимит/день, reset на новый день, не уходит в минус.
- `HumanDelay.test.ts` — задержка в диапазоне [min,max] детерминированно по Rng.
- `CommentDraftService.test.ts` — собирает промпт, зовёт LlmProvider (fake), отдаёт текст; не копирует пост дословно.
- `CommentJudge.test.ts` — режет по стоп-словам/длине/низкому confidence; пропускает валидное.
- `ActionGate.test.ts` — manual→pending; guardrails(judge ok)→quarantined; guardrails(judge fail)→blocked; full→execute; бюджет исчерпан→skipped.
- `QuarantineQueue.test.ts` — действие уходит после N мин; отмена в окне → не уходит; персист переживает рестарт.
- `IdeaExtractor.test.ts` — из постов извлекает топики+углы (fake LLM), не дословные посты.
- Блок B: `*.fixture.html` из живой ленты; `FeedReader.test.ts` парсит реальный пост; dedup по urn.

Зелёный бар (`npx vitest run`) + чистый `npm run build` — гейт перед каждым "готово".

## Field test (ручная проверка в Chrome — за Владом)

Автотесты не пересекают реальный isTrusted-барьер LinkedIn (синтетические события
из content script всегда `isTrusted:false`). Реальный like-toggle и submit коммента —
только живая проверка под твоей авторизацией.

0. **Обязательно: задать таргет** (иначе скоринг = 0 у всех → ноль лайков; UI настроек
   пока нет, `target.stack` пуст по умолчанию, `FeedReader` не извлекает headline).
   В консоли service worker расширения (`chrome://extensions` → Beacon → service worker):
   ```js
   chrome.storage.local.set({ 'engagement:settings': {
     config: { level: 'manual', guardrails: { minConfidence: 0.6, bannedPhrases: [], quarantineMinutes: 10, lenRange: [12,280] }, dailyLimits: { like: 60, comment: 10, connect: 0, post: 0 } },
     target: { stack: ['Vue','TypeScript','Frontend'], targetRoles: ['recruiter','talent'], geos: [], watchlistCompanies: [] },
     expertise: { headline: 'Frontend TechLead', stack: ['Vue','TypeScript'] },
     relevanceThreshold: 0.3
   }})
   ```
   (level всё равно берётся из селектора в Модулях — `modules:state` это SSOT.)
1. `npm run build` → `chrome://extensions` → Developer mode → Load unpacked → `dist/`.
2. Залогинься в LinkedIn, открой `/feed/`. Открой сайдбар Beacon.
3. **Модули** → «Вовлечённость в ленте» включён. Выбери уровень:
   - **Полный авто** — лайки уходят сразу (для проверки like-toggle);
   - **Авто+карантин** — комменты уходят с окном отмены; **Ручной** — в очередь (дефолт).
   - Уровень пишется в `modules:state`, SW читает его в гейт (SSOT).
4. **Защита** → «Запустить сегодняшнюю кампанию» → шлёт `RUN_ENGAGEMENT`.
5. Ожидать: строка прогона (`просмотрено/релевантных/выполнено/…`). На **Полном авто**
   релевантные не-лайкнутые посты получают лайк — сверить на ленте (иконка реакции).
   Релевантность зависит от `target.stack`/`targetRoles` (сейчас дефолт — пусто-ish;
   задать стек, чтобы посты прошли порог 0.3).
6. Карантин (если коммент в guardrails): на «Защите» — карточка с кнопкой **Отменить**
   (отмена в окне → действие не уходит).

### Что готово vs что на тебе

- ✅ **Runnable сейчас:** чтение ленты (живые селекторы), скоринг релевантности,
  дневной бюджет + **рандомные 8–45с между реальными действиями (anti-ban)**, гейт
  (manual/guardrails/full), карантин, банк идей, like-проход.
- ⚠️ **Известные ограничения (caveats):** (1) без шага 0 «Run» ничего не лайкает
  (пустой target + нет headline). (2) `findByUrn` теперь берёт видимый из тройного
  рендера поста — проверить, что клик попадает. (3) submit-кнопка коммента
  (`/^(comment|post|reply)$/i`) вживую не подтверждена — уточнить в field-тесте.
- 🧪 **Твой field-тест:** реальный like-toggle и submit коммента на живом аккаунте
  (техника вставки в ProseMirror подтверждена read-only, но не сабмитилась).
- ⏭ **Следующий инкремент (не в Todoist Фазе 2):** авто-генерация коммента в RUN-петле
  (CommentDraftService + ratio like:comment) — все кубики готовы и протестированы,
  нужен LLM-ключ/провайдер из настроек. Selector сабмит-кнопки коммента уточнить вживую.

## Carry / открытые

- Бэкенд-прокси для LLM-ключей — Todoist «Сквозное/Инфраструктура», не Фаза 2.
- Q4 лимиты Connect-Note — Фаза 3 (Smart Connect).
- Уведомление карантина: chrome.notifications (нужен permission) vs in-panel — решить в Блоке C.
