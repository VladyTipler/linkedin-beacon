# Content Layer 2 — авто-публикация черновика (design)

**Date:** 2026-06-26
**Status:** approved — proceed to plan
**Pillar moved:** **brand** (профессиональный бренд) — публикация постов (см.
`docs/superpowers/specs/2026-06-26-stubs-audit-and-ssi-map.md`, рычаг brand).
**Builds on:** Content Layer 1 (идея → черновик) — `DraftStore`, вкладка Контент/Черновики.

## 1. Цель

Опубликовать одобренный черновик в реальную ленту LinkedIn через composer
DOM-адаптер. Layer 1 довёл до читаемого черновика; Layer 2 — необратимый шаг
публикации, §5.5 дизайн-спеки.

## 2. Северная звезда — примирение (читать до кода)

Публикация — **намеренное исключение** из one-button / one-budget (architecture-overview):

- **Инвариант #5:** посты выше ставка, чем лайки/комменты → **approve-first, никогда
  full-auto по умолчанию, никогда в автономном run'е автопилота.**
- **Approve-first = сам клик «Опубликовать» на конкретном черновике** (human-in-the-loop).
  Это и есть гейт одобрения — отдельного «уровня автоматизации» у постов нет.
- **Недельный кап постов = safety-лимит на ручное действие, НЕ второй autopilot-бюджет.**
  Он не участвует в `autopilot:state` и не дробит «один бюджет на модуль» (тот — про
  автономный run лайков/комментов).
- **Кнопка на черновике ≠ launch-point.** Принцип «никаких per-module run-кнопок»
  относится к автономному run'у; ручная публикация одного одобренного черновика — другое.

> Если будущему тебе покажется, что Layer 2 нарушает северную звезду — перечитай этот
> раздел: исключение осознанное и ограниченное (только посты, только вручную, только
> approve-first).

## 3. Live DOM recon (выполнен 2026-06-26, read-only)

Полная карта — `docs/linkedin-dom-anchors.md` (секция «Post composer»). Два факта,
к которым comment-flow НЕ готовит:

1. **Composer живёт в SHADOW DOM.** Host `#interop-outlet` (`[data-testid="interop-shadowdom"]`),
   `.shadowRoot` **open**. Плоский `document.querySelector` не находит ничего из модалки —
   только через `host.shadowRoot`.
2. **Редактор — Quill, не ProseMirror.** `[data-test-ql-editor-contenteditable="true"]` /
   `.ql-editor[contenteditable="true"]`. `execCommand('insertText')` кладёт текст в DOM, но
   **Quill коммитит модель АСИНХРОННО** (MutationObserver): сразу после печати `ql-blank`
   ещё на месте и Post ещё `disabled`; через тик — снимаются. Подтверждено вживую.

**Decoy:** на странице ДВА `.ql-editor` — настоящий в shadow + копия в скрытом iframe
`/preload/`. Адаптер обязан идти строго через `#interop-outlet.shadowRoot`.

Якоря:
- Триггер (light DOM): `[aria-label="Start a post"]`.
- Модалка: `shadowRoot → [data-test-modal-id="sharebox"]`.
- Post: `shadowRoot → button.share-actions__primary-action` (text `Post`), `disabled` пока
  Quill не зарегил текст.
- Закрытие: `shadowRoot → button[aria-label="Dismiss"]` → confirm `Discard` / `Save as draft`.

## 4. Архитектура

Гексагон без изменений: core (pure) ← порты ← adapters/edge. Слои:
`sidepanel (UI) → service-worker (гейт/оркестратор) → content (единственный в DOM)`.

### 4.1 Composer-адаптер (content edge)

`src/content/domActions.ts` → `executeComposerPost(text, delay): Promise<ActionResult>`:

1. Открыть composer: `[aria-label="Start a post"]` в light DOM → клик.
2. Дождаться `host = #interop-outlet`, `sr = host.shadowRoot`, `editor = sr` →
   `[data-test-ql-editor-contenteditable="true"]` (poll, таймаут).
3. `editor.focus()` → каретка в конец через `sr.getSelection()` (fallback `window.getSelection()`).
4. Печать char-by-char: `document.execCommand('insertText', false, ch)` + `delay.nextMs(...)`.
5. **Поллить `!post.disabled`** (Quill async) с таймаутом — НЕ читать синхронно.
6. `post.click()`. Успех = sharebox исчез (poll до таймаута).
7. **Failure-path** (Post не активен / модалка висит): `Dismiss` → **`Discard`** (не «Save
   as draft» — не плодим полу-черновики) → вернуть `{ ok:false, reason }`.

Все селекторы и тексты выносятся в именованные константы рядом с `REACTION`/`EDITOR`.

> **Isolation-world риск (tightest constraint):** recon-тип-тест шёл в MAIN world (CDP
> eval); адаптер живёт в isolated world контент-скрипта. Прецедент комментов
> (execCommand из контент-скрипта) НЕ покрывает (а) selection в shadow root,
> (б) Quill. **Первый шаг плана — live smoke загруженного расширения**, печатающего
> throwaway в composer (дождаться enable Post → Discard, без публикации). Если
> isolated-world `execCommand`/`getSelection` в shadow не сработает — fallback
> `chrome.scripting.executeScript({ world: 'MAIN' })` для шага печати. Заложено заранее,
> чтобы провал не требовал переархитектуры.

### 4.2 Недельный бюджет постов (core, pure)

`src/lib/content/PostWeekBudget.ts` — зеркало `IdeaDayBudget`, но **ISO-week-keyed**:
- `PostWeek { week: string; used: number }`, ключ `POST_WEEK_BUDGET_KEY = 'posts:budget'`.
- `isoWeekKey(date): string` (YYYY-Www) — pure.
- `rolloverPostWeek(prev, weekKey)`, `recordPostWeek`, `remainingPosts(state, limit)`.
- `DEFAULT_POSTS_PER_WEEK = 3`.

`ContentSettings` += `postsPerWeek: number` (дефолт 3; рекомендация в UI-хинте).

### 4.3 SW-хендлер (оркестратор + гейт)

`src/service-worker/contentHandlers.ts` → `publishPost(deps, draftId)`:
1. Загрузить черновик из `DraftStore`; нет → `{ ok:false, reason:'not_found' }`.
2. Week-гейт: `remainingPosts <= 0` → `{ ok:false, reason:'budget' }`.
3. Найти вкладку LinkedIn + переинжект контент-скрипта (переиспользовать инфру
   engagement — `chrome.tabs.query({url})` + executeScript из живого манифеста).
4. Послать тексту в content → `executeComposerPost`.
5. Успех → `DraftStore.remove(draftId)` + `recordPostWeek`; ответ `{ ok, reason? }`.

Сообщение `PUBLISH_POST { draftId }` в `BeaconMessage`. Content-switch exhaustive →
no-op `case` (как `LIST_MODELS`/`GENERATE_*`).

### 4.4 UI

Контент/Черновики: на каждой карточке черновика — кнопка **«Опубликовать»** рядом с
edit/copy/regenerate/delete. Показывать остаток недельного капа (`remainingPosts`) и
индикатор успех/ошибка (как `save-error`). При успехе черновик исчезает из списка.

## 5. Язык контента (ввод Влада) — отдельный slice/коммит

Влад растит LinkedIn под валютные удалёнки → посты и комменты по-английски, с выбором
языка в настройках.

- `ContentSettings` += `contentLanguage: string` (дропдаун, дефолт **`'en'`**; опции
  English/Russian, расширяемо). **Unified** — один язык на посты И комменты (separate = YAGNI).
- Инжектится в промпт-сборку `DraftGenerator` (посты) **и** `CommentDraftService` (комменты).
- Сборка промпта pure → юнит-тест; **расширить существующий boundary-тест генерации**
  (`contentHandlers.test.ts`), чтобы язык реально доходил до тела LLM-запроса — не только пост.

## 6. Граница тестирования (честно: covered vs live-only)

**Покрыто тестом (jsdom / pure):**
- Locate-логика адаптера на фикстуре с **реальной shadow-структурой** (`attachShadow`):
  пробивка `#interop-outlet.shadowRoot`, поиск editor/Post, **игнор декоя** `.ql-editor`
  вне host, выбор Post-кнопки, ветка failure→Discard.
- `PostWeekBudget` (pure, ISO-week rollover/record/remaining).
- `publishPost` SW-хендлер с фейками `KeyValueStore`/content-bridge: week-гейт,
  удаление черновика, not_found, budget-block — **пересекает границу** SW↔store↔draft.
- Язык доходит до тела LLM-запроса (расширение существующего boundary-теста).

**Только вживую (как `executeComment` — jsdom не воспроизводит):**
- Async-печать в Quill + клик Post + закрытие модалки. **Шаг 1 плана — live smoke**
  загруженного расширения (isolated world). Первый полноценный прогон = **test-пост +
  удаление** (не засеивать ленту флагмана).

## 7. Вне scope (YAGNI / обрезка Фазы 1)

- Media, Schedule post (кнопки в shadow есть — не трогаем). Только текст.
- Full-auto публикация (later opt-in, §5.5) — не сейчас.
- История опубликованных постов / «доказательство brand» — витрина, не рычаг.
- Объединение двух бюджет-пулов — отдельная задача.

## 8. Порядок реализации (для плана)

1. **Live smoke** загруженного расширения: печать в composer из isolated world →
   подтвердить технику (или включить MAIN-world fallback). Снимает tightest constraint.
2. `PostWeekBudget` (pure, TDD) + `postsPerWeek` в ContentSettings.
3. Composer-адаптер `executeComposerPost` (locate-тесты jsdom; печать — live).
4. SW `publishPost` + `PUBLISH_POST` message + content no-op case (boundary-тест).
5. UI: кнопка «Опубликовать» + остаток капа + индикатор.
6. **Отдельный коммит — язык:** `contentLanguage` + инжект в DraftGenerator &
   CommentDraftService + расширение boundary-теста.
7. `npm test` зелёный + `npm run build`; живая проверка (test-пост + удаление).

## 9. Открытые вопросы

Нет — дефолты согласованы (posts/week=3, unified `contentLanguage='en'`, кнопка на
карточке черновика, только текст). Heads-up про реальный пост при живой проверке — дан,
согласован.
