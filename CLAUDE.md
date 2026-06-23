# Beacon (linkedin-beacon) — Project Rules & Workflow

**Beacon — LinkedIn SSI Engine.** Браузерное расширение (Chrome MV3) для роста LinkedIn SSI по принципу *pull > push*. Safety-first, human-in-the-loop.
**Дизайн-спека:** https://artifacts.kanev.space/beacon-design-spec/
**Дизайн-эталон (демо):** https://artifacts.kanev.space/beacon-linkedin-ssi/ (= `docs/design-reference.html`)
**Статус:** Фаза 1 (MVP) — план в `docs/plans/phase-1.md`. Standalone, без привязки к Job Radar.

**Стек:**
- **UI:** Vue 3.5 + TypeScript + Vite 6 (npm)
- **Расширение:** Manifest V3 — `@crxjs/vite-plugin`, sidePanel API, service worker, content script
- **Тесты:** Vitest + `@vue/test-utils` + jsdom
- **AI:** LLM-слой за `LlmProvider` (OCP/LSP) — `openrouter` (основной) + `gemini` (free tier)
- **SSI-данные:** внутренний API LinkedIn (`/sales-api/salesApiSsi`) как primary + DOM-парсер `/sales/ssi` как fallback
- **Репозиторий:** GitLab (`v_sandz/linkedin-beacon`), ветка `main`

## Команда

- **Vlad Kanev** — solo (architect + dev).

Окружение: Claude Code + Superpowers + Compound Engineering + Context7 + Memory Bank MCP + Agent Browser + start-session/end-session/frontend-design.

---

## 🎯 Главное правило: единый воркфлоу одной задачи

> Шпаргалка обязательна для каждой фичи. Не пропускать шаги.

### Принципы

- **Одна задача = одна сессия.** Перед каждой новой — `/clear`.
- **Сессия начинается со `/start-session`, заканчивается `/end-session`.** Без них контекст между сессиями теряется.
- **Ветка под каждую задачу — от `main`.** Формат: `feature/<slug>`. Никогда не коммитим напрямую в `main`.
- **Скиллы Superpowers агент должен вызывать сам.** Если скилл не вызван — вызывай явно: `/имя-скилла` или «используй скилл X».
- **TDD обязательно.** В Plan-шаге убедиться, что TDD встроен. Если нет — «не забудь про TDD, тесты перед кодом».

### Полный pipeline одной задачи

```
0. GIT SYNC (обязательно перед каждой задачей)
   git status                                 # working dir должна быть чистая
   git switch main && git pull --ff-only      # подтянуть свежий main
   git switch -c feature/<slug>               # ветка под задачу ОТ main

   ⚠ Если working dir НЕ чистая → закоммитить/застешить ДО pull'а.
   ⚠ Если pull не fast-forward → разобраться, не делать merge-commit вслепую.

1. START
   /clear → /start-session → /using-superpowers
   • start-session подтянет контекст из .claude/context/linkedin-beacon/

2. BRAINSTORMING (спецификация)
   /superpowers:brainstorming
   • Описать фичу → агент задаёт вопросы → корректируешь
   • На выходе — DESIGN DOC, утвердить

3. PLANNING (план)
   /superpowers:writing-plans
   • Декомпозированный план задач, соответствующий design doc
   • ⚠ ПРОВЕРИТЬ, что TDD встроен в план
   • Утвердить

4. EXECUTION
   /superpowers:executing-plans
   • Выбрать СУБАГЕНТЫ + «по возможности параллельно»
   • Каждая фича/фикс по TDD: тест → код

5. CODE REVIEW (обязательно)
   /compound-engineering:ce-code-review  (или /superpowers:requesting-code-review)
   Опционально: /compound-engineering:ce-simplify-code  (YAGNI / dead code / over-abstraction)

6. MANUAL VERIFICATION
   • npm run build → load unpacked dist/ в chrome://extensions → пощупать руками
   • Сверить UI side-by-side с docs/design-reference.html
   • Если косяк — конкретно указать → агент исправляет

7. GIT FLOW
   • Коммиты в feature-ветку → git push -u origin <branch> → MR в main на GitLab
   • Merge — human-gate (жмёшь ты, агент не мёржит сам)

8. END
   /end-session
   • Обновляет Memory Bank: архитектура, паттерны, грабли
   • Извлекает повторяющиеся паттерны → может предложить создать скилл
```

### Сжатая шпаргалка одной строкой

```
git switch main && git pull --ff-only → git switch -c feature/<slug>
  → /clear → /start-session → /using-superpowers
  → /superpowers:brainstorming  (design doc, утвердить)
  → /superpowers:writing-plans  (план + TDD, утвердить)
  → /superpowers:executing-plans  (субагенты, параллельно)
  → /compound-engineering:ce-code-review  (обязательно)
  → [/compound-engineering:ce-simplify-code]  (опционально)
  → npm run build + ручная проверка в Chrome (сверка с design-reference)
  → коммит + push + MR в main → human-gate merge
  → /end-session
```

> CI/AI-ревью на MR пока не настроен (нет `.gitlab-ci.yml`). Ревью — локально через скиллы выше. Можно добавить позже.

---

## TDD — обязательно (правило, высеченное кровью)

1. **Unit-тест** на pure-логику ядра / парсеры / мапперы / стратегии — **перед** кодом.
2. **Контракт-/boundary-тест** на сквозной сценарий, если задача затрагивает >1 модуля или пересекает внешнюю границу — **перед** кодом.
3. Перед «готово» — `npm test` зелёный (+ `npm run build` без ошибок типов).
4. Исключения без обязательного теста: чисто визуал / разметка / переименования.
5. One-line bugfix — тест **в том же коммите, после** фикса.

Прогон: `npm test` (vitest run), `npm run test:watch` в разработке. Отдельного `test:feature` нет — всё через vitest.

### Тестирование интеграций — без исключений

> **Любая интеграция всегда должна быть покрыта тестами, чтобы гарантировать работу по контрактам.**

Граница между моим кодом и внешней системой обязана быть покрыта тестом, который **пересекает** эту границу. Pure unit-тесты на обеих сторонах НЕ доказывают что мост работает.

**Что считается границей в этом проекте:**
- **Внутренний API LinkedIn** (`/sales-api/salesApiSsi`) — shape ответа, заголовки (`csrf-token`), маппинг в `SsiSnapshot` (`src/lib/ssi-api/`).
- **DOM-парсер** `/sales/ssi` — стратегии `DomSelectorStrategy` / `TextScanStrategy` против реального HTML-фикстура.
- **LLM API** (OpenRouter / Gemini) — сборка тела запроса и разбор ответа в `mappers.ts` (контракт-тест JSON shape).
- **Chrome API boundary** — `chrome.storage`, `chrome.cookies`, `chrome.alarms`, message-роутинг service worker ↔ sidepanel ↔ content (адаптеры в `src/adapters/`).
- Сериализация/десериализация на любых boundary.

**Pre-commit checkpoint:** Явно ответь себе: «Есть ли в diff'е хотя бы один тест, который РЕАЛЬНО пересекает границу — проверяет shape реального ответа API / триггерит реальный маппинг / гоняет парсер по реальному HTML?» Если «нет» — STOP, пиши тест ПЕРЕД commit'ом.

**Техники:** контракт-тест на JSON shape реального ответа LinkedIn/LLM; round-trip парсера по сохранённому HTML-фикстуру; мок `chrome.*` с realistic-payload для адаптеров и роутинга сообщений.

---

## Принципы кода

- **Файл ≤ 300 строк кода (строгое правило).** Превышение — сигнал к декомпозиции по файлам с единой ответственностью. Длинные константы / промпты / сгенерированный код выноси отдельно.
- **SOLID (строгое правило).** S — один файл/тип = одна ответственность. O — расширяй через порты/стратегии (новый LLM-провайдер или SSI-стратегия без правки потребителя). L — фейки подставляются по тому же контракту. I — мелкие сфокусированные порты (`SsiSource`, `KeyValueStore`, `Clock`, `HttpClient`), без god-interface. D — core зависит от абстракций, не от `chrome`/`document`/`fetch`.
- **Гексагон: зависимости направлены внутрь.** `core` (`src/lib`, pure, 100% unit-tested) не импортирует `chrome`/`document`/`fetch` — только узкие порты. `adapters` — тонкие impure edge-обёртки. Слои: `sidepanel` (UI) → `service-worker` (оркестратор) → `content` (единственный мост в DOM LinkedIn).
- **Single Source of Truth.** Настройки в одном месте, передаются через сообщения/конфиг, не дублируются. Оба источника SSI возвращают один доменный `SsiSnapshot` — ядро не знает, откуда данные.
- **Safety-first / human-in-the-loop.** pull > push. Минимум permissions (см. `manifest.config.ts`), host-доступ только к LinkedIn. Никаких автодействий без подтверждения человека.
- **Мягкая деградация вне расширения.** В обычной вкладке `chrome.*` отсутствует — UI падает на демо-данные, не крашится.

## UI/UX — пиксель-в-пиксель с эталоном

**Source of truth:** `docs/design-reference.html` (verbatim копия демо-артефакта) + спека https://artifacts.kanev.space/beacon-design-spec/.

- Любая UI-фича сайдбара должна **визуально один-в-один** соответствовать эталону.
- Перед мерджем — открыть эталон в браузере и сверить side-by-side (классы, цвета, отступы, состояния).
- Дизайн-токены и компоненты — фиксировать в memory-bank при выявлении.
- При расхождении дизайна с эталоном — **эталон всегда прав**. Нужны изменения — править эталон/спеку сначала, потом код.

## Документация и контекст

### Memory Bank — переопределён локально

Memory Bank MCP переопределён через `.mcp.json` так, чтобы хранить контекст **внутри репо** (`.claude/context/linkedin-beacon/`) и коммитить в git.

- Project name всегда `linkedin-beacon` (совпадает с именем директории).
- В начале сессии — `list_project_files linkedin-beacon` + чтение `architecture-overview.md` (если есть).
- При исследовании / решении проблемы / выявлении паттерна — сохранять новым файлом через `memory_bank_write`.
- **НЕ кладём секреты / токены / API-ключи** в `.claude/context/` — это коммитится.
- После клонирования репо — подтвердить использование `.mcp.json` при первом запуске Claude Code.

### Context7
- **Context7 MCP** — актуальная документация библиотек/фреймворков (Vue, Vite, crxjs, chrome.* API, Vitest). Использовать проактивно при работе с внешними либами.

## Git Flow

- **`main` — рабочая/релизная ветка.** Прямые коммиты в `main` запрещены.
- Ветка под каждую задачу — **от `main`**: `feature/<slug>`.
- MR — **в `main`** на GitLab. Merge — human-gate (жмёт человек, не агент).
- Коммиты максимально лаконичные. Жертвуй грамматикой ради краткости. Conventional-формат (`feat`/`fix`/`chore`/`docs`/`refactor`).
- Перед пушем — `/compound-engineering:ce-simplify-code` по коммитам фичи (`git diff main..HEAD`).

## Build & Load (вместо деплоя)

Это расширение, не сервис — «деплой» = собрать и загрузить unpacked.

1. `npm install`
2. `npm run build` — `vue-tsc --noEmit` + `vite build` → готовый `dist/` с `manifest.json`.
3. `chrome://extensions` → Developer mode → **Load unpacked** → выбрать папку **`dist/`** (не корень!).
4. Итеративно: `npm run dev` держит `dist/` свежим; в `chrome://extensions` жми **Reload (⟳)** после изменений service worker / content script (панель — HMR).

---

## Scope (Фаза 1)

Объём Фазы 1 зафиксирован в `docs/plans/phase-1.md` и дизайн-спеке. Standalone V1, без привязки к Job Radar.

**Правило обрезки:** Если фича не помогает основному сценарию (рост SSI по pull-модели, safety-first) — она вне Фазы 1 без долгих обсуждений. Сверяться с планом и спекой, не расширять scope молча.

---

## Если агент отклонился от воркфлоу

- Забыл вызвать скилл → **явно** вызвать `/имя-скилла`.
- Ушёл в сторону → вернуть на рельсы конкретным указанием.
- Не написал тест перед кодом → откат, тест первым.

## Дата и время

`date` для актуальной даты каждый раз, когда нужно указать.
