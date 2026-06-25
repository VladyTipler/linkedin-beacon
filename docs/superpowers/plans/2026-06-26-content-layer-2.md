# Content Layer 2 — авто-публикация черновика — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Опубликовать одобренный черновик в реальную ленту LinkedIn через composer DOM-адаптер (approve-first, недельный safety-кап), поднимая столб SSI **brand**.

**Architecture:** Гексагон без изменений. Composer живёт в **shadow DOM** (`#interop-outlet.shadowRoot`), редактор — **Quill** (коммит модели асинхронный). Новый content-edge `executeComposerPost`; новое сообщение `PUBLISH_POST { draftId }` (panel→SW) переиспользует существующий `EXECUTE_ACTION` (SW→content) с `type:'post'`. Недельный бюджет — pure core. Язык контента — отдельный slice.

**Tech Stack:** Vue 3.5 + TS + Vite 6, MV3 content script, Vitest + jsdom.

## Global Constraints

- **Файл ≤ 300 строк; SOLID.** Длинные константы выноси.
- **core (`src/lib`) не импортирует** `chrome`/`document`/`fetch` — только порты. Composer-адаптер живёт в `src/content` (edge), НЕ в core.
- **Граница обязана быть покрыта тестом, пересекающим её** (CLAUDE.md). Async-печать в Quill — единственное исключение (jsdom не воспроизводит), проверяется ВЖИВУЮ.
- **Posts approve-first, НИКОГДА не full-auto, НИКОГДА в автономном run'е** (инвариант #5). Недельный кап — safety-лимит ручного действия, не autopilot-бюджет.
- **chrome.storage:** массивы читать через `asArray`; никогда не доверять shape.
- **Exhaustive content-switch:** каждый новый `BeaconMessage` обязан получить `case` в `src/content/index.ts` (no-op для SW-only) или `vue-tsc` падает.
- **Селекторы строго через `#interop-outlet.shadowRoot`** — глобальный `.ql-editor` ловит decoy из скрытого `/preload/` iframe.
- Коммиты лаконичные, conventional. Прямо в `main` (этот проект). `npm test` + `npm run build` зелёные перед «готово».

---

### Task 1: Composer-адаптер `executeComposerPost` + content-проводка (+ live smoke)

Самый рискованный кусок — front-load. Locate-логика покрыта jsdom; async-печать проверяется живым smoke загруженного расширения (isolated world ≠ MAIN world, где шёл recon).

**Files:**
- Modify: `src/content/domActions.ts` (добавить константы, `findComposer`, `executeComposerPost`, shadow-caret + wait-хелперы)
- Modify: `src/lib/types.ts` (`ActionRequest.payload` += `post?: string`)
- Modify: `src/content/index.ts` (`runAction`: ветка `type==='post'`)
- Test: `src/content/domActions.test.ts` (создать или дополнить — locate-тесты на shadow-фикстуре)

**Interfaces:**
- Produces: `findComposer(root: ParentNode): ComposerHandle | null` где `ComposerHandle = { editor: HTMLElement; post: HTMLButtonElement; shadow: ShadowRoot }`; `executeComposerPost(root: Document, text: string, delay: HumanDelay): Promise<ActionResult>`.
- Consumes: `HumanDelay` (`src/lib/engagement/HumanDelay`), `ActionResult` (уже экспортится из `domActions.ts`).

- [ ] **Step 1: Написать падающий locate-тест** (`src/content/domActions.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { findComposer } from './domActions'

/** Build the real composer shape: an OPEN shadow root on #interop-outlet
 *  containing the sharebox modal, the Quill editor and the Post button.
 *  Plus a DECOY .ql-editor in the light DOM that must be ignored. */
function mountComposer(): Document {
  document.body.innerHTML = `
    <div id="decoy"><div class="ql-editor" data-test-ql-editor-contenteditable="true">decoy</div></div>
    <div id="interop-outlet" data-testid="interop-shadowdom"></div>`
  const host = document.querySelector('#interop-outlet') as HTMLElement
  const sr = host.attachShadow({ mode: 'open' })
  sr.innerHTML = `
    <div data-test-modal-id="sharebox" role="dialog">
      <div class="ql-editor ql-blank" role="textbox"
           data-test-ql-editor-contenteditable="true"
           aria-label="Text editor for creating content"></div>
      <button class="share-actions__primary-action artdeco-button" disabled>Post</button>
      <button aria-label="Dismiss">x</button>
    </div>`
  return document
}

describe('findComposer', () => {
  it('locates the editor + Post button inside the #interop-outlet shadow root', () => {
    const handle = findComposer(mountComposer())
    expect(handle).not.toBeNull()
    expect(handle!.editor.getAttribute('aria-label')).toBe('Text editor for creating content')
    expect(handle!.post.textContent).toBe('Post')
  })

  it('ignores the decoy .ql-editor outside the shadow host', () => {
    const handle = findComposer(mountComposer())
    // the decoy is in light DOM; the returned editor must be the shadow one
    expect(handle!.editor.classList.contains('ql-blank')).toBe(true)
    expect(handle!.editor.textContent).toBe('')
  })

  it('returns null when the sharebox modal is not open', () => {
    document.body.innerHTML = `<div id="interop-outlet"></div>`
    ;(document.querySelector('#interop-outlet') as HTMLElement).attachShadow({ mode: 'open' })
    expect(findComposer(document)).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/content/domActions.test.ts`
Expected: FAIL — `findComposer is not a function` / не экспортирован.

- [ ] **Step 3: Реализовать адаптер** (`src/content/domActions.ts`)

Добавить рядом с существующими константами:

```ts
// ── Post composer (share box). Lives in a SHADOW DOM; editor is Quill (async
// commit). See docs/linkedin-dom-anchors.md "Post composer". ──
const POST_TRIGGER = '[aria-label="Start a post"]'
const SHADOW_HOST = '#interop-outlet'
const QL_EDITOR = '[data-test-ql-editor-contenteditable="true"]'
const POST_SUBMIT = 'button.share-actions__primary-action'
const DISMISS = 'button[aria-label="Dismiss"]'

export interface ComposerHandle {
  editor: HTMLElement
  post: HTMLButtonElement
  shadow: ShadowRoot
}

/** Locate the composer editor + Post button STRICTLY inside #interop-outlet's
 *  open shadow root (a plain document query would grab the /preload decoy). */
export function findComposer(root: ParentNode): ComposerHandle | null {
  const host = root.querySelector(SHADOW_HOST) as HTMLElement | null
  const shadow = host?.shadowRoot ?? null
  if (!shadow) return null
  const editor = shadow.querySelector<HTMLElement>(QL_EDITOR)
  const post = shadow.querySelector<HTMLButtonElement>(POST_SUBMIT)
  if (!editor || !post) return null
  return { editor, post, shadow }
}

/**
 * Publish a post: open the composer, type the text char-by-char (Quill accepts
 * execCommand insertText, but commits its model ASYNCHRONOUSLY — so we POLL the
 * Post button until it enables before clicking), submit, confirm the modal closed.
 * On any failure → Dismiss → Discard (never leave a half-draft). Edge — the typing
 * path is exercised live, not in jsdom.
 */
export async function executeComposerPost(
  root: Document,
  text: string,
  delay: HumanDelay
): Promise<ActionResult> {
  if (!text.trim()) return { ok: false, reason: 'empty_text' }
  const trigger = root.querySelector<HTMLElement>(POST_TRIGGER)
  if (!trigger) return { ok: false, reason: 'composer_trigger_not_found' }
  trigger.click()

  const handle = await waitForValue(() => findComposer(root), 6000)
  if (!handle) return { ok: false, reason: 'composer_not_found' }
  const { editor, post, shadow } = handle

  editor.focus()
  placeCaretAtEndIn(editor, shadow)
  for (const char of [...text]) {
    document.execCommand('insertText', false, char)
    await sleep(delay.nextMs(40, 160))
  }

  // Quill registers via MutationObserver → the Post button enables on a later tick.
  const ready = await waitForCond(() => !post.disabled, 4000)
  if (!ready) {
    await dismissComposer(root, shadow)
    return { ok: false, reason: 'post_button_disabled' }
  }
  post.click()

  const closed = await waitForCond(() => findComposer(root) === null, 8000)
  if (!closed) {
    await dismissComposer(root, shadow)
    return { ok: false, reason: 'modal_did_not_close' }
  }
  return { ok: true }
}

/** Abandon the composer cleanly: Dismiss → confirm Discard (NOT "Save as draft"). */
async function dismissComposer(root: Document, shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLElement>(DISMISS)?.click()
  const discard = await waitForValue(() => {
    const host = root.querySelector(SHADOW_HOST) as HTMLElement | null
    const sr = host?.shadowRoot
    return (
      [...(sr?.querySelectorAll<HTMLElement>('button') ?? [])].find(
        (b) => (b.textContent ?? '').trim().toLowerCase() === 'discard'
      ) ?? null
    )
  }, 2000)
  discard?.click()
}

function placeCaretAtEndIn(el: HTMLElement, shadow: ShadowRoot): void {
  const selection =
    (shadow as unknown as { getSelection?: () => Selection | null }).getSelection?.() ??
    window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}
```

И добавить два generic-хелпера рядом с существующим `waitFor`:

```ts
/** Poll a predicate until true or timeout. Returns whether it became true. */
async function waitForCond(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(100)
  }
  return false
}

/** Poll a factory until it returns non-null or timeout. */
async function waitForValue<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = find()
    if (v) return v
    await sleep(100)
  }
  return null
}
```

- [ ] **Step 4: Расширить тип и `runAction`**

`src/lib/types.ts` — в `ActionRequest`:
```ts
  payload?: { note?: string; comment?: string; post?: string }
```

`src/content/index.ts` — импорт + ветка в `runAction`:
```ts
import { executeComment, executeLike, executeComposerPost } from './domActions'
```
```ts
  if (action.type === 'post') {
    return executeComposerPost(document, action.payload?.post ?? '', delay)
  }
```

- [ ] **Step 5: Запустить тесты — зелёные**

Run: `npx vitest run src/content/domActions.test.ts && npm run build`
Expected: PASS; build без ошибок типов.

- [ ] **Step 6: Commit**

```bash
git add src/content/domActions.ts src/content/domActions.test.ts src/lib/types.ts src/content/index.ts
git commit -m "feat(content): composer post adapter (shadow DOM + Quill async-poll), runAction 'post'"
```

- [ ] **Step 7: LIVE SMOKE (human-gate, Влад + загруженное расширение)** — снимает isolation-world риск ДО бюджета/UI.

`npm run build` → в `chrome://extensions` нажать Reload (⟳) на Beacon. Открыть `linkedin.com/feed`. Получить tabId и послать `EXECUTE_ACTION` из **service-worker консоли** расширения (isolated world = контент-скрипт):
```js
// в DevTools service worker'а Beacon:
const [t] = await chrome.tabs.query({ url: '*://*.linkedin.com/feed/*' })
await chrome.tabs.sendMessage(t.id, { type:'EXECUTE_ACTION',
  action:{ type:'post', target:{url:'x'}, payload:{ post:'Beacon isolated-world smoke — will discard' } } })
```
Ожидание: composer открылся, текст набрался, Post активировался. **Затем — ассистент через CDP кликает Dismiss→Discard (НЕ публиковать).** Результат сообщения `{ok:false, reason:'modal_did_not_close'}` ожидаем (мы не дали ему опубликовать) — важно лишь, что **печать сработала и Post активировался в isolated world**.

⚠️ Если печать НЕ сработала / Post не активировался → fallback: шаг печати выполнять через `chrome.scripting.executeScript({ target:{tabId}, world:'MAIN', func, args:[text] })` из SW (адаптер тогда сигналит SW, что нужен MAIN-world ввод). Заложено в дизайне; перепроверить и закоммитить фикс перед Task 3.

---

### Task 2: `PostWeekBudget` (pure, ISO-week) + `postsPerWeek` в настройках

**Files:**
- Create: `src/lib/content/PostWeekBudget.ts`
- Test: `src/lib/content/PostWeekBudget.test.ts`
- Modify: `src/lib/content/settings.ts` (`ContentSettings.postsPerWeek` + дефолт)

**Interfaces:**
- Produces: `isoWeekKey(d: Date): string`; `PostWeek = { week: string; used: number }`; `POST_WEEK_BUDGET_KEY = 'posts:budget'`; `DEFAULT_POSTS_PER_WEEK = 3`; `rolloverPostWeek(prev, weekKey)`, `recordPostWeek(state, n)`, `remainingPosts(state, limit)`.
- Consumes: ничего (pure).

- [ ] **Step 1: Падающий тест** (`PostWeekBudget.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import {
  isoWeekKey, rolloverPostWeek, recordPostWeek, remainingPosts, type PostWeek
} from './PostWeekBudget'

describe('isoWeekKey', () => {
  it('formats ISO-8601 year-week', () => {
    expect(isoWeekKey(new Date('2026-06-26T00:00:00Z'))).toBe('2026-W26')
  })
  it('puts 2027-01-01 (Friday) in week 53 of 2026 per ISO-8601', () => {
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53')
  })
})

describe('post week budget', () => {
  it('rolls over to a fresh week (used reset) but keeps the same-week count', () => {
    const prev: PostWeek = { week: '2026-W25', used: 2 }
    expect(rolloverPostWeek(prev, '2026-W26')).toEqual({ week: '2026-W26', used: 0 })
    expect(rolloverPostWeek(prev, '2026-W25')).toBe(prev)
  })
  it('records usage and computes remaining against the limit', () => {
    const s = recordPostWeek({ week: '2026-W26', used: 0 }, 1)
    expect(s.used).toBe(1)
    expect(remainingPosts(s, 3)).toBe(2)
    expect(remainingPosts({ week: '2026-W26', used: 3 }, 3)).toBe(0)
  })
})
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/lib/content/PostWeekBudget.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать** (`src/lib/content/PostWeekBudget.ts`)

```ts
/** Persisted week-keyed posts/week counter (mirrors IdeaDayBudget, ISO-week). */
export interface PostWeek {
  week: string
  used: number
}

export const POST_WEEK_BUDGET_KEY = 'posts:budget'
export const DEFAULT_POSTS_PER_WEEK = 3

/** ISO-8601 year-week key, e.g. "2026-W26". Pure. */
export function isoWeekKey(d: Date): string {
  // Copy to UTC midnight; shift to the Thursday of this week (ISO weeks anchor on it).
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = date.getUTCDay() || 7 // Sun=0 → 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function rolloverPostWeek(prev: PostWeek | null, weekKey: string): PostWeek {
  if (prev && prev.week === weekKey) return prev
  return { week: weekKey, used: 0 }
}

export function recordPostWeek(state: PostWeek, n: number): PostWeek {
  return { week: state.week, used: state.used + Math.max(0, n) }
}

export function remainingPosts(state: PostWeek, limit: number): number {
  return Math.max(0, limit - state.used)
}
```

- [ ] **Step 4: Расширить `ContentSettings`** (`src/lib/content/settings.ts`)

В интерфейс добавить `postsPerWeek: number`; импортнуть `DEFAULT_POSTS_PER_WEEK`; в `loadContentSettings` вернуть:
```ts
    postsPerWeek:
      typeof raw?.postsPerWeek === 'number' && raw.postsPerWeek > 0
        ? raw.postsPerWeek
        : DEFAULT_POSTS_PER_WEEK,
```

- [ ] **Step 5: Тесты зелёные**

Run: `npx vitest run src/lib/content/PostWeekBudget.test.ts && npm run build`
Expected: PASS; build чистый.

- [ ] **Step 6: Commit**

```bash
git add src/lib/content/PostWeekBudget.ts src/lib/content/PostWeekBudget.test.ts src/lib/content/settings.ts
git commit -m "feat(content): ISO-week posts/week budget + postsPerWeek setting (default 3)"
```

---

### Task 3: SW `publishPost` хендлер + `PUBLISH_POST` сообщение + проводка

**Files:**
- Modify: `src/service-worker/contentHandlers.ts` (`publishPost` + `PublishDeps`)
- Modify: `src/lib/types.ts` (`BeaconMessage` += `PUBLISH_POST`)
- Modify: `src/content/index.ts` (no-op `case 'PUBLISH_POST'`)
- Modify: `src/service-worker/index.ts` (роут + `publish` bridge через `sendToLinkedInTab` + `withPageActivity`)
- Modify: `src/lib/autopilot/statusLabels.ts` (`PUBLISHING = 'Публикую…'`)
- Test: `src/service-worker/contentHandlers.test.ts` (boundary-тест `publishPost`)

**Interfaces:**
- Produces: `publishPost(deps: PublishDeps, draftId: string): Promise<{ ok: boolean; reason?: string }>`; `PublishDeps = { store: KeyValueStore; clock: Clock; publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined> }`.
- Consumes: `DraftStore`, `PostWeekBudget` (Task 2), `loadContentSettings` (Task 2 поле).

- [ ] **Step 1: Падающий boundary-тест** (дополнить `contentHandlers.test.ts`)

```ts
import { publishPost } from './contentHandlers'
import type { Draft } from '@lib/types'

describe('publishPost', () => {
  const draft: Draft = { id: 'd1', ideaTopic: 'T', ideaAngle: 'A', text: 'Hello world', createdAt: '2026-06-26T00:00:00.000Z' }
  const base = () => memStore({ 'content:drafts': [draft], 'content:settings': { postsPerWeek: 3 } })

  it('not_found when the draft id is unknown', async () => {
    const res = await publishPost(
      { store: base(), clock: fixedClock, publish: async () => ({ ok: true }) },
      'missing'
    )
    expect(res).toEqual({ ok: false, reason: 'not_found' })
  })

  it('budget when the week cap is exhausted', async () => {
    const store = memStore({
      'content:drafts': [draft], 'content:settings': { postsPerWeek: 1 },
      'posts:budget': { week: '2026-W26', used: 1 }
    })
    const res = await publishPost({ store, clock: fixedClock, publish: async () => ({ ok: true }) }, 'd1')
    expect(res).toEqual({ ok: false, reason: 'budget' })
  })

  it('publishes: removes the draft and records the week budget', async () => {
    const store = base()
    let publishedText = ''
    const res = await publishPost(
      { store, clock: fixedClock, publish: async (t) => { publishedText = t; return { ok: true } } },
      'd1'
    )
    expect(res).toEqual({ ok: true })
    expect(publishedText).toBe('Hello world')
    expect(await store.get('content:drafts')).toEqual([])
    expect(await store.get('posts:budget')).toEqual({ week: '2026-W25', used: 1 })
  })

  it('keeps the draft and surfaces the reason when the DOM publish fails', async () => {
    const store = base()
    const res = await publishPost(
      { store, clock: fixedClock, publish: async () => ({ ok: false, reason: 'post_button_disabled' }) },
      'd1'
    )
    expect(res).toEqual({ ok: false, reason: 'post_button_disabled' })
    expect(await store.get('content:drafts')).toEqual([draft]) // not consumed on failure
  })
})
```

> Примечание: `fixedClock` = `2026-06-25T00:00:00Z` → `isoWeekKey` = `2026-W25` (проверь ассерт budget week соответствует).

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: FAIL — `publishPost` не экспортирован.

- [ ] **Step 3: Реализовать `publishPost`** (`src/service-worker/contentHandlers.ts`)

Импорты:
```ts
import { isoWeekKey, rolloverPostWeek, recordPostWeek, remainingPosts, POST_WEEK_BUDGET_KEY, type PostWeek } from '@lib/content/PostWeekBudget'
```
Код:
```ts
export interface PublishDeps {
  store: KeyValueStore
  clock: Clock
  /** Sends the text to the content script's composer adapter; undefined if no tab. */
  publish: (text: string) => Promise<{ ok: boolean; reason?: string } | undefined>
}

/**
 * Approve-first publish of ONE draft (Vlad clicked «Опубликовать»). Gated by the
 * weekly post cap (safety, NOT an autopilot budget). On a successful DOM publish:
 * consume the draft + record the week. A failed publish keeps the draft + reason.
 */
export async function publishPost(
  deps: PublishDeps,
  draftId: string
): Promise<{ ok: boolean; reason?: string }> {
  const drafts = new DraftStore(deps.store)
  const draft = (await drafts.all()).find((d) => d.id === draftId)
  if (!draft) return { ok: false, reason: 'not_found' }

  const { postsPerWeek } = await loadContentSettings(deps.store)
  const weekKey = isoWeekKey(deps.clock.now())
  const budget = rolloverPostWeek((await deps.store.get<PostWeek>(POST_WEEK_BUDGET_KEY)) ?? null, weekKey)
  if (remainingPosts(budget, postsPerWeek) <= 0) return { ok: false, reason: 'budget' }

  const res = await deps.publish(draft.text)
  if (!res?.ok) return { ok: false, reason: res?.reason ?? 'publish_failed' }

  await drafts.remove(draftId)
  await deps.store.set(POST_WEEK_BUDGET_KEY, recordPostWeek(budget, 1))
  return { ok: true }
}
```

- [ ] **Step 4: Сообщение + content no-op + статус-лейбл**

`src/lib/types.ts` в `BeaconMessage`:
```ts
  /** sidepanel → SW: publish an approved draft now (approve-first); replies { ok, reason? }. */
  | { type: 'PUBLISH_POST'; draftId: string }
```
`src/content/index.ts` — в группу SW-only no-op (рядом с `GENERATE_DRAFT`):
```ts
    case 'PUBLISH_POST':
```
`src/lib/autopilot/statusLabels.ts`:
```ts
export const PUBLISHING = 'Публикую…'
```

- [ ] **Step 5: Роут в SW** (`src/service-worker/index.ts`)

Импорт `PUBLISHING` из statusLabels (рядом с `GENERATING_IDEAS`). В `switch`:
```ts
    case 'PUBLISH_POST':
      void withPageActivity(
        () =>
          content.publishPost(
            {
              store,
              clock,
              publish: (text) =>
                sendToLinkedInTab<{ ok: boolean; reason?: string }>({
                  type: 'EXECUTE_ACTION',
                  action: { type: 'post', target: { url: 'https://www.linkedin.com/feed/' }, payload: { post: text } }
                })
            },
            message.draftId
          ),
        PUBLISHING
      ).then(sendResponse)
      return true
```

- [ ] **Step 6: Тесты + build зелёные**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts && npm run build`
Expected: PASS; build чистый (exhaustive-switch доволен).

- [ ] **Step 7: Commit**

```bash
git add src/service-worker/contentHandlers.ts src/service-worker/index.ts src/lib/types.ts src/content/index.ts src/lib/autopilot/statusLabels.ts src/service-worker/contentHandlers.test.ts
git commit -m "feat(content): PUBLISH_POST handler — week-gated approve-first publish via EXECUTE_ACTION"
```

---

### Task 4: UI — кнопка «Опубликовать» + остаток недельного капа

**Files:**
- Modify: `src/sidepanel/composables/useContent.ts` (`publishing`, `publishDraft`, `postsLeft`, `loadPostBudget`)
- Modify: `src/sidepanel/screens/ContentScreen.vue` (кнопка + индикатор + остаток)
- Test: `src/sidepanel/composables/useContent.test.ts` (создать или дополнить — `publishDraft` через мок `panelBus`)

**Interfaces:**
- Consumes: `panelBus.request({ type:'PUBLISH_POST', draftId })` → `{ ok, reason? }`; `remainingPosts`/`isoWeekKey`/ключи из Task 2.
- Produces: `publishDraft(id)`, reactive `publishing` (id|null), `postsLeft` (number).

- [ ] **Step 1: Падающий тест** (`useContent.test.ts`) — мок panelBus, проверка что успех чистит черновик, ошибка кладёт reason в `error`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const request = vi.fn()
vi.mock('../lib/panelBus', () => ({ panelBus: { request: (...a: unknown[]) => request(...a) } }))

import { useContent } from './useContent'

beforeEach(() => { request.mockReset(); localStorage.clear?.() })

describe('publishDraft', () => {
  it('on success clears error and reloads drafts', async () => {
    request.mockResolvedValueOnce({ ok: true })
    const c = useContent()
    await c.publishDraft('d1')
    expect(request).toHaveBeenCalledWith({ type: 'PUBLISH_POST', draftId: 'd1' })
    expect(c.error.value).toBeNull()
    expect(c.publishing.value).toBeNull()
  })
  it('on failure surfaces the reason', async () => {
    request.mockResolvedValueOnce({ ok: false, reason: 'budget' })
    const c = useContent()
    await c.publishDraft('d1')
    expect(c.error.value).toBe('budget')
  })
})
```

> Если `ChromeStorageStore` падает в jsdom без `chrome`, использовать существующий в проекте мок `chrome.storage` (см. как настроены другие composable-тесты; при отсутствии — добавить минимальный `globalThis.chrome` stub в начале теста). Это часть TDD-шага, не плейсхолдер: storage-чтения в `useContent` мягко деградируют.

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/sidepanel/composables/useContent.test.ts`
Expected: FAIL — `publishDraft` не существует.

- [ ] **Step 3: Реализовать в `useContent.ts`**

```ts
import { remainingPosts, rolloverPostWeek, isoWeekKey, POST_WEEK_BUDGET_KEY, type PostWeek } from '@lib/content/PostWeekBudget'
import { loadContentSettings } from '@lib/content/settings'
```
Внутри `useContent`:
```ts
  const publishing = ref<string | null>(null)
  const postsLeft = ref<number>(0)

  async function loadPostBudget() {
    const { postsPerWeek } = await loadContentSettings(store)
    const week = isoWeekKey(new Date())
    const budget = rolloverPostWeek((await store.get<PostWeek>(POST_WEEK_BUDGET_KEY)) ?? null, week)
    postsLeft.value = remainingPosts(budget, postsPerWeek)
  }

  async function publishDraft(id: string) {
    publishing.value = id
    error.value = null
    const res = await panelBus.request<{ ok: boolean; reason?: string }>({ type: 'PUBLISH_POST', draftId: id })
    publishing.value = null
    if (!res?.ok) { error.value = res?.reason ?? 'publish_failed'; return }
    await loadDrafts()
    await loadPostBudget()
  }
```
Добавить `publishing, postsLeft, publishDraft, loadPostBudget` в `return`.

- [ ] **Step 4: Кнопка в `ContentScreen.vue`**

В деструктуризацию `useContent()` добавить `publishing, postsLeft, publishDraft, loadPostBudget`. Вызвать `loadPostBudget()` там же, где `loadDrafts()` (на маунте/переключении вкладки).

В блоке Черновики — заголовок с остатком:
```html
<p v-if="drafts.length" class="hint" data-testid="posts-left">Осталось публикаций на неделе: {{ postsLeft }}</p>
```
В ряд кнопок карточки черновика (перед «Копировать») добавить:
```html
<button class="btn primary" :disabled="publishing === d.id || postsLeft <= 0"
        :data-testid="`publish-${d.id}`" @click="publishDraft(d.id)">
  {{ publishing === d.id ? 'Публикую…' : 'Опубликовать' }}
</button>
```

- [ ] **Step 5: Тесты + build зелёные; сверка с эталоном**

Run: `npx vitest run src/sidepanel/composables/useContent.test.ts && npm run build`
Expected: PASS; build чистый. Визуально кнопка/хинт не ломают карточку (сверить с `docs/design-reference.html` при ручной проверке).

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/composables/useContent.ts src/sidepanel/screens/ContentScreen.vue src/sidepanel/composables/useContent.test.ts
git commit -m "feat(content): publish button on drafts + weekly cap remaining indicator"
```

---

### Task 5: Язык контента (отдельный slice) — `contentLanguage`, инжект в посты И комменты

**Files:**
- Modify: `src/lib/content/settings.ts` (`contentLanguage`, дефолт `'en'`, мап имён)
- Modify: `src/lib/content/DraftGenerator.ts` (param `language`)
- Modify: `src/lib/engagement/CommentDraftService.ts` (`CommentDraftInput.language`)
- Modify: `src/service-worker/contentHandlers.ts` (`generateDraft` и `commentOnPost` передают язык)
- Modify: `src/sidepanel/screens/SettingsScreen.vue` (дропдаун языка)
- Test: `src/service-worker/contentHandlers.test.ts` (capturing fake — язык доходит до тела LLM-запроса)

**Interfaces:**
- Produces: `ContentSettings.contentLanguage: string`; `languageName(code: string): string`; `DraftGenerator.generate(idea, expertise, postPrompt, language)`; `CommentDraftInput.language: string`.

- [ ] **Step 1: Падающий boundary-тест** (capturing fake — пересекает границу LLM)

```ts
/** Captures the request body so we can assert the language reached the wire. */
function capturingHttp(): { http: HttpClient & HttpGet; bodies: unknown[] } {
  const bodies: unknown[] = []
  return {
    bodies,
    http: {
      async postJson<T>(_url: string, body: unknown) { bodies.push(body); return { choices: [{ message: { content: 'x' } }] } as T },
      async getJson<T>() { return {} as T }
    }
  }
}

it('generateDraft injects the configured language into the LLM request', async () => {
  const { http, bodies } = capturingHttp()
  const store = memStore({ ...CONFIGURED, 'content:settings': { contentLanguage: 'en' } })
  await generateDraft({ store, http, clock: fixedClock, newId: () => 'id1' }, { topic: 'T', angle: 'A' })
  const sys = JSON.stringify(bodies[0])
  expect(sys).toMatch(/English/)
})
```

> Сверь точную сигнатуру `postJson(url, body, headers?)` в `FetchHttpClient`/`OpenRouterProvider` и подгони позицию `body`.

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/service-worker/contentHandlers.test.ts`
Expected: FAIL — язык не инжектится.

- [ ] **Step 3: Реализовать**

`settings.ts`:
```ts
export const DEFAULT_CONTENT_LANGUAGE = 'en'
const LANG_NAMES: Record<string, string> = { en: 'English', ru: 'Russian' }
export function languageName(code: string): string { return LANG_NAMES[code] ?? 'English' }
```
В `ContentSettings` += `contentLanguage: string`; в `loadContentSettings` вернуть `contentLanguage: raw?.contentLanguage?.trim() ? raw.contentLanguage : DEFAULT_CONTENT_LANGUAGE`.

`DraftGenerator.generate(idea, expertise, postPrompt, language: string)` — в массив `system` добавить:
```ts
      `Write the post in ${language}.`,
```
`CommentDraftService`: `CommentDraftInput` += `language: string`; в `system` добавить `\`Write the comment in ${language}.\``.

`contentHandlers.ts`:
- `generateDraft`: `const { contentLanguage } = await loadContentSettings(deps.store)` и вызвать `new DraftGenerator(provider).generate(idea, expertise, postPrompt, languageName(contentLanguage))`.
- `commentOnPost`: пробросить `language: languageName(settings.contentLanguage)` в `.draft({ post, expertise, tone, language })`.

- [ ] **Step 4: Дропдаун в `SettingsScreen.vue`** — в секции Контент добавить `<select>` English/Russian, биндинг к `content:settings.contentLanguage`, автосейв (как существующие поля).

- [ ] **Step 5: Тесты + build зелёные**

Run: `npx vitest run && npm run build`
Expected: ALL PASS; build чистый.

- [ ] **Step 6: Commit**

```bash
git add src/lib/content/settings.ts src/lib/content/DraftGenerator.ts src/lib/engagement/CommentDraftService.ts src/service-worker/contentHandlers.ts src/sidepanel/screens/SettingsScreen.vue src/service-worker/contentHandlers.test.ts
git commit -m "feat(content): content language setting (default English) injected into posts + comments"
```

---

### Task 6: Полная верификация + живой test-пост (test+delete)

- [ ] **Step 1: Весь прогон**

Run: `npx vitest run && npm run build`
Expected: все тесты зелёные (300+), build без ошибок типов. `git status` чистый.

- [ ] **Step 2: ce-simplify / review (по воркфлоу)**

`git diff main@{task1-start}..HEAD` → `/compound-engineering:ce-simplify-code` по диффу фичи.

- [ ] **Step 3: LIVE — реальная публикация (human-gate, Влад)** ⚠️ необратимо, флагман-аккаунт.

`npm run build` → Reload расширения. ⚙ → ключ + Expertise + язык English. Контент/Идеи → сгенерить → В черновик. На черновике (коротком, **test-пост, который не жалко**) → «Опубликовать». Подтвердить: composer открылся, текст набрался, Post активировался, **пост опубликован** (модалка закрылась, остаток капа уменьшился, черновик исчез). **Затем — удалить пост из ленты вручную** (не засеивать ленту). Проверить недельный кап: при остатке 0 кнопка «Опубликовать» disabled.

- [ ] **Step 4: Зафиксировать результат** в memory-bank (`progress.md`, `gotchas.md` если всплыло новое) — Layer 2 shipped & live-verified.

---

## Self-Review

**Spec coverage:**
- §4.1 composer-адаптер (shadow/Quill/async-poll/failure→Discard) → Task 1 ✅
- §4.2 недельный бюджет + `postsPerWeek` → Task 2 ✅
- §4.3 SW `publishPost` + `PUBLISH_POST` + reuse EXECUTE_ACTION → Task 3 ✅
- §4.4 UI кнопка + остаток капа → Task 4 ✅
- §5 язык (посты+комменты, дефолт en, boundary-тест) → Task 5 ✅
- §6 граница covered/live — locate jsdom (Task 1 t.1–3), week pure (Task 2), publishPost boundary (Task 3), язык boundary (Task 5); live smoke (Task 1 s.7) + live publish (Task 6) ✅
- §2 примирение one-budget — отражено в Global Constraints + комментариях кода ✅
- §7 YAGNI (без media/schedule) — адаптер только текст ✅

**Placeholder scan:** код во всех code-шагах конкретный; два явных «сверь сигнатуру» (postJson позиция body; chrome-мок в composable-тесте) помечены как часть TDD-шага, не как недоделка.

**Type consistency:** `findComposer`/`ComposerHandle`/`executeComposerPost`, `PublishDeps.publish`, `PostWeek`/`isoWeekKey`/`POST_WEEK_BUDGET_KEY`, `PUBLISH_POST{draftId}`, `payload.post`, `contentLanguage`/`languageName` — имена согласованы между задачами. `ActionResult` переиспользуется из `domActions.ts`; SW использует структурно совместимый `{ok,reason?}`.
