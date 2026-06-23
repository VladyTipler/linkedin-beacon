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

## Carry / открытые

- Бэкенд-прокси для LLM-ключей — Todoist «Сквозное/Инфраструктура», не Фаза 2.
- Q4 лимиты Connect-Note — Фаза 3 (Smart Connect).
- Уведомление карантина: chrome.notifications (нужен permission) vs in-panel — решить в Блоке C.
