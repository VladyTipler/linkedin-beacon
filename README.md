# Beacon — LinkedIn SSI Engine

Браузерное расширение (Chrome MV3) для роста **LinkedIn SSI** по принципу *pull > push*: прокачиваем профиль так, чтобы рекрутёры писали сами. Safety-first, human-in-the-loop.

- **Дизайн-спека:** https://artifacts.kanev.space/beacon-design-spec/
- **Дизайн-эталон (демо):** https://artifacts.kanev.space/beacon-linkedin-ssi/ (= `docs/design-reference.html`)
- **Статус:** Фаза 1 (MVP) — сайдбар 1:1 с демо, SSI-движок, LLM-слой (2 провайдера). Standalone, без привязки к Job Radar.

---

## Стек

Vue 3 · TypeScript · Vite · [`@crxjs/vite-plugin`](https://crxjs.dev) · Vitest. Manifest V3 (sidePanel API).

## Архитектура (SOLID)

```
adapters (impure, edge)              core (pure, 100% unit-tested)
─────────────────────────            ─────────────────────────────
DomSsiSource     (document)   ──►    SsiParser  (strategies[], OCP)
ChromeStorageStore (storage)  ──►    SsiRepository
FetchHttpClient  (fetch)      ──►    LlmProvider (OpenRouter | Gemini, OCP)
SystemClock      (Date.now)   ──►    parse-helpers / mappers (pure fns)
```

Зависимости направлены внутрь: core не импортирует `chrome`/`document`/`fetch` — только узкие порты (`SsiSource`, `KeyValueStore`, `Clock`, `HttpClient`). Слои: `src/sidepanel` (UI) → `src/service-worker` (оркестратор) → `src/content` (DOM-мост). Подробности — `docs/plans/phase-1.md`.

---

## Разработка

```bash
npm install            # с dev-зависимостями
npm test               # vitest (60 тестов)
npm run build          # vue-tsc --noEmit + vite build → dist/
npm run dev            # vite в watch-режиме (HMR в dist/)
```

## Загрузка в Chrome (unpacked)

1. `npm install && npm run build` — соберётся папка **`dist/`** с готовым `manifest.json`.
2. Открой `chrome://extensions`.
3. Включи **Developer mode** (тумблер справа сверху).
4. **Load unpacked** → выбери папку **`dist/`** (не корень репо!).
5. Закрепи иконку Beacon на тулбаре, клик по ней открывает **сайдбар справа**.

> Для итеративной разработки: `npm run dev` держит `dist/` свежим, в `chrome://extensions` жми **Reload (⟳)** на карточке расширения после изменений (HMR панели работает, но изменения service worker / content script требуют reload).

## Как пощупать SSI

1. Залогинься в LinkedIn в этом же профиле Chrome.
2. Открой `https://www.linkedin.com/sales/ssi` — content script распарсит страницу и отправит снапшот в панель.
3. Открой сайдбар Beacon → экран **SSI** покажет реальный балл; кнопка обновления триггерит повторный парс активной вкладки LinkedIn.

> ⚠️ Селекторы `/sales/ssi` в `DomSelectorStrategy` пока на синтетической фикстуре. Если реальный балл не подхватился — нужен дамп DOM живой страницы, чтобы уточнить селекторы (это единственный известный пробел перед полевым тестом; `TextScanStrategy` — резервный текстовый парсер).

## Вне контекста расширения

В обычной вкладке браузера `chrome.*` отсутствует — панель **мягко деградирует** на демо-данные и не падает. Реальный персист (`chrome.storage.local`) и парсинг работают только как загруженное расширение.

---

## Структура

```
src/
├── lib/                 # core (pure, тестируемое)
│   ├── ssi/             #   SSI-движок: parser + стратегии + helpers
│   ├── feed/            #   FeedHarvester (источник идей для контента)
│   ├── llm/             #   LLM-слой: contracts, mappers, OpenRouter/Gemini, factory
│   ├── storage/         #   SsiRepository
│   ├── ports.ts         #   узкие порты (ISP/DIP)
│   └── types.ts         #   доменная модель + контракты сообщений
├── adapters/            # тонкие edge-адаптеры (chrome/document/fetch/Date)
├── service-worker/      # MV3 service worker — роутер сообщений + персист
├── content/             # content script — единственный слой в DOM LinkedIn
└── sidepanel/           # Vue-приложение сайдбара (4 экрана, 1:1 с демо)
docs/
├── plans/phase-1.md     # executable TDD-план фазы 1
└── design-reference.html# дизайн-эталон (verbatim копия демо-артефакта)
```

## LLM-провайдеры (§10 спеки)

Два взаимозаменяемых backend'а за `LlmProvider` (LSP), создаются фабрикой `createLlmProvider` по `config.provider` (OCP — регистр, не switch):

- **`openrouter`** — основной, ключ через `Authorization: Bearer`.
- **`gemini`** — прямой Google Gemini API (бесплатный tier для тех, кто не хочет платить за модели); ключ в query-string.

Реальные сетевые вызовы — только через `FetchHttpClient`; вся логика (сборка тела запроса, разбор ответа) — в чистых `mappers.ts`, покрыта тестами без сети.
