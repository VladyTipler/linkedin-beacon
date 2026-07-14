# PYMK Connect-Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Когда people-search коннект даёт 0, автоматически добирать остаток бюджета коннектов из PYMK (`/mynetwork/grow/`).

**Architecture:** `runConnectStep` параметризуется источником (search|pymk). Новый `runConnectWithFallback` гоняет search-проход, и если `executed===0` (не disabled/budget) — pymk-проход, разделяя бюджет/sent-set/историю. Harvest и executeConnect обобщаются на `button` (PYMK-контрол — button, не anchor). PYMK harvest = scroll-load.

**Tech Stack:** Chrome MV3, Vue 3.5, TS, Vitest, jsdom. Гексагон (core `src/lib` pure → adapters).

## Global Constraints

- Файл ≤ 300 строк кода. SOLID. core (`src/lib`) не импортирует chrome/document/fetch.
- TDD: тест перед кодом. `npm test` (vitest run) зелёный + `npm run build` (vue-tsc + vite) без ошибок перед «готово».
- Boundary-тесты пересекают границу: harvest по РЕАЛЬНОМУ HTML, message-роутинг с realistic payload.
- Content switch над `BeaconMessage` ИСЧЕРПЫВАЮЩИЙ (`assertNever`) — каждый новый variant требует `case`.
- Коммиты: conventional, лаконичные. Direct-to-main (норма проекта). Версия SSOT = `package.json`.
- Selectors SSOT: `docs/linkedin-dom-anchors.md`.

---

## Предусловие: незакоммиченный honest-reason фикс в дереве

Рабочее дерево содержит готовый (протестированный, live-verified reason-flip) honest-reason фикс + диагностический трейс. Task 1 очищает трейс и коммитит фикс как фундамент.

---

### Task 1: Фундамент — снять диагностический трейс, закоммитить honest-reason фикс

**Files:**
- Modify: `src/service-worker/index.ts` (runConnectsThen — убрать трейс)
- Modify: `src/content/index.ts` (HARVEST_PEOPLE_PAGE — убрать memberCount из ответа)
- Modify: `src/lib/types.ts` (HarvestResult — убрать `memberCount`)

**Interfaces:**
- Produces: чистый `runConnectStep` (none_connectable + пагинация + pool_pending), `harvestPeoplePage(harvest, sleep, isEmpty, attempts?, interval?, peopleCount?)`, `HarvestOutcome` включает `'none_connectable'`.

- [ ] **Step 1: Снять трейс из `runConnectsThen`** — вернуть тело к чистому виду (убрать `__page`, `__trace`, `T`, `sentAtStart`, все `T(...)` вызовы, `await store.set('connect:trace', __trace)`; harvest/nextPage/connect/navigate — без логирующих обёрток):

```ts
async function runConnectsThen(tabId: number, afterUrl: string, cancelled: () => Promise<boolean>): Promise<ModuleOutcome> {
  const rng = new MathRandomRng()
  const pacer = new HumanDelay(rng)
  const setActivity = (label: string) => setStage(tabId, label)
  const res = await runConnectStep({
    store, clock, rng,
    navigate: async (url) => {
      const ok = await navigateLinkedInTab(tabId, url)
      await setActivity(SEARCHING_PEOPLE)
      return ok
    },
    harvest: () => harvestPeoplePageFrom(tabId),
    nextPage: () => nextPeoplePageFrom(tabId),
    connect: async (c) => {
      await setActivity(CONNECTING)
      return chrome.tabs
        .sendMessage(tabId, {
          type: 'EXECUTE_ACTION',
          action: { type: 'connect', target: { url: c.profileUrl, meta: { memberId: c.memberId, name: c.name } } }
        })
        .catch(() => undefined)
    },
    pace: () => contentSleep(tabId, pacer.nextMs(8000, 30000)),
    cancelled
  })
  await navigateLinkedInTab(tabId, afterUrl)
  return { executed: res.executed, reason: res.reason }
}
```

- [ ] **Step 2: Убрать memberCount из ответа HARVEST_PEOPLE_PAGE** (оставить `peopleCount` аргумент — это часть фикса):

```ts
      void harvestPeoplePage(
        () => harvestPeople(document),
        (ms) => sleep(ms),
        isPeopleSearchEmpty,
        40,
        500,
        () => harvestProfiles(document).length
      ).then(sendResponse)
      return true // async sendResponse
```

- [ ] **Step 3: Убрать `memberCount` из `HarvestResult`** (`src/lib/types.ts`) — оставить только `candidates` + `outcome`.

- [ ] **Step 4: Прогон тестов + билд**

Run: `npm test`
Expected: PASS (544 теста)
Run: `npm run build`
Expected: без ошибок типов

- [ ] **Step 5: Commit**

```bash
git add src/content/harvestPeople.ts src/content/harvestPeople.test.ts src/content/index.ts \
  src/service-worker/connectHandlers.ts src/service-worker/connectHandlers.test.ts src/service-worker/index.ts \
  src/lib/types.ts src/lib/autopilot/reasonLabels.ts src/lib/autopilot/reasonLabels.test.ts
git commit -m "fix(connect): paginate past all-Pending pages + honest pool_pending reason

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `harvestPeople` ловит и `button` (PYMK), + boundary-тест

**Files:**
- Create: `src/content/__fixtures__/pymk-card.ts`
- Modify: `src/content/harvestPeople.ts:3,13-14` (селектор + var)
- Test: `src/content/harvestPeople.test.ts`

**Interfaces:**
- Consumes: `harvestPeople(root: ParentNode): PersonCandidate[]`
- Produces: `harvestPeople` матчит `a` И `button` c aria `Invite … to connect`; `PYMK_CARD_HTML` фикстур.

- [ ] **Step 1: Создать PYMK-фикстур** (`src/content/__fixtures__/pymk-card.ts`) — карточка с `button`-контролом (структура подтверждена live-recon: componentkey `ConnectButtonstate:invitation:urn:li:member:<id>_connect`, aria `Invite <name> to connect`, профиль `a[href*="/in/"]`, хедлайн 2-й `<p>`):

```ts
// Real /mynetwork/grow/ PYMK card shape (captured live 2026-07-13). Connect control is a
// <button> (people-search uses <a>) — everything else identical. PII-sanitized.
export const PYMK_CARD_HTML = `
<section>
  <div>
    <a href="https://www.linkedin.com/in/jane-doe-123/?misc=x"><span>Jane Doe</span></a>
    <p>2nd</p>
    <p>Talent Acquisition Specialist | Tech Recruiter</p>
    <p>Veronica and 20 other mutual connections</p>
    <button aria-label="Invite Jane Doe to connect"
      componentkey="ConnectButtonstate:invitation:urn:li:member:87274562_connect">Connect</button>
  </div>
</section>`
```

- [ ] **Step 2: Написать падающий тест** (`harvestPeople.test.ts`):

```ts
import { PYMK_CARD_HTML } from './__fixtures__/pymk-card'

describe('harvestPeople — PYMK card (button connect control, not anchor)', () => {
  beforeEach(() => { document.body.innerHTML = PYMK_CARD_HTML })

  it('parses a PYMK card whose Connect control is a <button>', () => {
    expect(harvestPeople(document)).toEqual([
      { memberId: '87274562', name: 'Jane Doe',
        headline: 'Talent Acquisition Specialist | Tech Recruiter',
        profileUrl: 'https://www.linkedin.com/in/jane-doe-123/' }
    ])
  })
})
```

- [ ] **Step 3: Прогон — убедиться, что падает**

Run: `npx vitest run src/content/harvestPeople.test.ts -t "PYMK card"`
Expected: FAIL (0 найдено — селектор ищет только `a`)

- [ ] **Step 4: Обобщить селектор** (`harvestPeople.ts`): строка 3 `const CONNECT_ANCHOR = 'a[aria-label^="Invite "][aria-label$=" to connect"]'` → tag-agnostic; в цикле тип `HTMLAnchorElement` → `HTMLElement`, `for (const a of ...)` → `for (const el of ...)`, `a.getAttribute` → `el.getAttribute`, `a.parentElement` → `el.parentElement`:

```ts
// Connect control is an <a> on people-search but a <button> on PYMK (/mynetwork/) — match
// BOTH by the aria-label + componentkey, which are identical across the two surfaces.
const CONNECT_CONTROL = '[aria-label^="Invite "][aria-label$=" to connect"]'
```
```ts
export function harvestPeople(root: ParentNode): PersonCandidate[] {
  const out: PersonCandidate[] = []
  const seen = new Set<string>()
  for (const el of root.querySelectorAll<HTMLElement>(CONNECT_CONTROL)) {
    const member = (el.getAttribute('componentkey') ?? '').match(/urn:li:member:(\d+)/)?.[1]
    if (!member || seen.has(member)) continue
    let card: Element | null = el.parentElement
    while (card && !card.querySelector('a[href*="/in/"]')) card = card.parentElement
    if (!card) continue
    const profile = card.querySelector<HTMLAnchorElement>('a[href*="/in/"]')
    const ps = card.querySelectorAll('p')
    seen.add(member)
    out.push({
      memberId: member,
      name: (el.getAttribute('aria-label') ?? '').replace(/^Invite /, '').replace(/ to connect$/, ''),
      headline: (ps[1]?.textContent ?? '').trim(),
      profileUrl: (profile?.getAttribute('href') ?? '').split('?')[0]
    })
  }
  return out
}
```

- [ ] **Step 5: Прогон — PYMK + существующие people-search тесты зелёные**

Run: `npx vitest run src/content/harvestPeople.test.ts`
Expected: PASS (PYMK card + все прежние: Olena/Predrag anchor-карточки, exclude Follow/Pending)

- [ ] **Step 6: Обновить `docs/linkedin-dom-anchors.md`** — добавить в секцию про Connect, что контрол может быть `a` (people-search) ИЛИ `button` (PYMK), селектор tag-agnostic.

- [ ] **Step 7: Commit**

```bash
git add src/content/harvestPeople.ts src/content/harvestPeople.test.ts \
  src/content/__fixtures__/pymk-card.ts docs/linkedin-dom-anchors.md
git commit -m "feat(connect): harvestPeople matches PYMK button controls (tag-agnostic)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `executeConnect` кликает и `button`-контрол + live-recon PYMK connect-flow

**Files:**
- Modify: `src/content/domActions.ts:265-267` (селектор anchor → tag-agnostic)
- Test: `src/content/domActions.test.ts` (или существующий connect boundary-тест)

**Interfaces:**
- Consumes: `executeConnect(root, { memberId, name }, delay): Promise<ActionResult>`
- Produces: `executeConnect` кликает `a` ИЛИ `button` `[componentkey*="member:<id>_connect"]`.

- [ ] **Step 1: Написать падающий тест** — фейковый root с `button[componentkey*="member:42_connect"]` + shadow-модал «Send without a note»; executeConnect должен кликнуть button и отправить. (Смоделировать по существующему executeConnect boundary-тесту, заменив `<a>` на `<button>`.)

- [ ] **Step 2: Прогон — падает** (селектор `a[...]` не находит button)

Run: `npx vitest run src/content/domActions.test.ts -t "button"`
Expected: FAIL (`connect_anchor_not_found`)

- [ ] **Step 3: Обобщить селектор** (`domActions.ts:265-267`):

```ts
  const anchor = root.querySelector<HTMLElement>(
    `[componentkey*="member:${candidate.memberId}_connect"]`
  )
```

- [ ] **Step 4: Прогон — зелёный** (button и anchor оба кликаются)

Run: `npx vitest run src/content/domActions.test.ts`
Expected: PASS

- [ ] **Step 5: LIVE-RECON PYMK connect-flow (CDP, read-only → 1 реальный клик)** — открыть `/mynetwork/grow/`, кликнуть один PYMK Connect-`button`, зафиксировать: открывается ли тот же shadow-модал `[role="dialog"][aria-labelledby="send-invite-modal"]` c `button[aria-label="Send without a note"]` (тогда executeConnect работает как есть), ИЛИ инвайт уходит СРАЗУ без модала. Задокументировать в `docs/linkedin-dom-anchors.md` (секция PYMK). Если direct-send → добавить ветку в executeConnect (Step 6), иначе пропустить.

- [ ] **Step 6 (условно): direct-send ветка** — если recon показал прямую отправку: после `anchor.click()`, если `findSendNoNote` не появился за 6с, НО контрол сменил состояние на Pending (`[componentkey*="member:<id>_pending"]` появился) → `{ ok: true }` вместо `send_button_not_found`. Тест на эту ветку.

- [ ] **Step 7: Commit**

```bash
git add src/content/domActions.ts src/content/domActions.test.ts docs/linkedin-dom-anchors.md
git commit -m "feat(connect): executeConnect clicks PYMK button controls + PYMK flow recon

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: PYMK scroll-harvest — content-хендлер + сообщение + SW-обёртка

**Files:**
- Modify: `src/lib/types.ts` (BeaconMessage union: `HARVEST_PYMK`)
- Modify: `src/content/index.ts` (хендлер `HARVEST_PYMK` + `harvestPymkScroll` + exhaustive case)
- Modify: `src/service-worker/index.ts` (обёртка `harvestPymkFrom`)
- Test: `src/content/harvestPeople.test.ts` (юнит на scroll-accumulate логику, если вынести чистой)

**Interfaces:**
- Consumes: `harvestPeople(document)`, `HarvestResult`.
- Produces: сообщение `{ type: 'HARVEST_PYMK'; target: number }` → content отвечает `HarvestResult`. SW: `harvestPymkFrom(tabId: number): Promise<HarvestResult>`.

- [ ] **Step 1: Добавить variant в `BeaconMessage`** (`types.ts`, рядом с HARVEST_PEOPLE_PAGE-семейством):

```ts
  /** SW → content: scroll-harvest connectable PYMK people (/mynetwork/); replies HarvestResult. */
  | { type: 'HARVEST_PYMK'; target: number }
```

- [ ] **Step 2: Написать падающий юнит на чистую scroll-accumulate логику** — вынести накопление в чистую `pymkScrollHarvest(harvest, scroll, sleep, target, opts?)` (аналог `harvestPeoplePage`, но по скроллу; стоп по target ИЛИ N пустых раундов). Тест: карточки прибывают по раундам, дедуп по memberId, стоп по target; пустой → `empty`/`not_ready`:

```ts
describe('pymkScrollHarvest (scroll-load connectable people)', () => {
  const c = (id: string) => ({ memberId: id, name: id, headline: '', profileUrl: '' })
  it('scrolls until target unique candidates collected', async () => {
    const rounds = [[c('1')], [c('1'), c('2')], [c('2'), c('3')]]
    let r = 0
    const res = await pymkScrollHarvest(() => rounds[Math.min(r, rounds.length - 1)], async () => { r++ }, async () => {}, 3, { maxStale: 3, maxRounds: 10 })
    expect(res.candidates.map(x => x.memberId).sort()).toEqual(['1', '2', '3'])
    expect(res.outcome).toBe('ok')
  })
  it('reports empty when no cards ever appear', async () => {
    const res = await pymkScrollHarvest(() => [], async () => {}, async () => {}, 5, { maxStale: 2, maxRounds: 5 })
    expect(res.outcome).toBe('empty')
  })
})
```

- [ ] **Step 3: Прогон — падает** (функции нет)

Run: `npx vitest run src/content/harvestPeople.test.ts -t "pymkScrollHarvest"`
Expected: FAIL

- [ ] **Step 4: Реализовать `pymkScrollHarvest`** (в `harvestPeople.ts`, pure, injected):

```ts
/**
 * Scroll-harvest connectable people from an infinite-scroll surface (PYMK /mynetwork/).
 * Unlike people-search there is NO pagination — cards lazy-load on scroll. Poll harvest(),
 * dedup by memberId, scroll, repeat until `target` unique OR `maxStale` empty rounds. Pure.
 */
export async function pymkScrollHarvest(
  harvest: () => PersonCandidate[],
  scroll: () => Promise<void>,
  sleepMs: () => Promise<void>,
  target: number,
  opts: { maxStale?: number; maxRounds?: number } = {}
): Promise<HarvestResult> {
  const { maxStale = 3, maxRounds = 20 } = opts
  const acc = new Map<string, PersonCandidate>()
  let stale = 0
  for (let round = 0; round < maxRounds; round++) {
    const before = acc.size
    for (const p of harvest()) if (!acc.has(p.memberId)) acc.set(p.memberId, p)
    stale = acc.size > before ? 0 : stale + 1
    if (acc.size >= target || stale >= maxStale) break
    await scroll()
    await sleepMs()
  }
  return acc.size > 0
    ? { candidates: [...acc.values()].slice(0, target), outcome: 'ok' }
    : { candidates: [], outcome: 'empty' }
}
```

- [ ] **Step 5: Прогон — зелёный**

Run: `npx vitest run src/content/harvestPeople.test.ts -t "pymkScrollHarvest"`
Expected: PASS

- [ ] **Step 6: Content-хендлер + exhaustive case** (`content/index.ts`) — импорт `pymkScrollHarvest`; хендлер скроллит окно (PYMK скроллит window/`document.scrollingElement`, не inner main):

```ts
    case 'HARVEST_PYMK':
      void pymkScrollHarvest(
        () => harvestPeople(document),
        async () => { (document.scrollingElement ?? document.documentElement).scrollTop = (document.scrollingElement ?? document.documentElement).scrollHeight },
        () => sleep(1200),
        message.target
      ).then(sendResponse)
      return true // async sendResponse
```

- [ ] **Step 7: SW-обёртка** (`service-worker/index.ts`, рядом с harvestPeoplePageFrom):

```ts
/** Scroll-harvest connectable PYMK people from /mynetwork/ (fallback source). */
async function harvestPymkFrom(tabId: number, target: number): Promise<HarvestResult> {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'HARVEST_PYMK', target }).catch(() => null)
  return (r as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' }
}
```

- [ ] **Step 8: Билд (exhaustive switch) + тесты**

Run: `npm run build`
Expected: без ошибок (assertNever доволен новым case)
Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/content/index.ts src/content/harvestPeople.ts \
  src/content/harvestPeople.test.ts src/service-worker/index.ts
git commit -m "feat(connect): PYMK scroll-harvest content handler + SW wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `runConnectStep` — параметр источника (search|pymk)

**Files:**
- Modify: `src/service-worker/connectHandlers.ts` (opts.source, PYMK URL, skip keyword gate)
- Test: `src/service-worker/connectHandlers.test.ts`

**Interfaces:**
- Consumes: `runConnectStep(deps: ConnectDeps): Promise<ConnectStepResult>`
- Produces: `runConnectStep(deps, opts?: { source?: 'search' | 'pymk' })`. При `source:'pymk'` — НЕТ keyword-гейта, navigate на `PYMK_URL`. Export `PYMK_URL`.

- [ ] **Step 1: Написать падающие тесты** (`connectHandlers.test.ts`):

```ts
export const PYMK_URL_EXPECTED = 'https://www.linkedin.com/mynetwork/grow/'

it('pymk source navigates to /mynetwork/ and skips the keyword gate', async () => {
  const d = deps()
  d._m.set('connect:settings', { searchKeywords: '' }) // нет ключей — не важно для PYMK
  const res = await runConnectStep(d, { source: 'pymk' })
  expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/')
  expect(res.reason).not.toBe('no_keywords')
  expect(d.connect).toHaveBeenCalledTimes(2) // harvest дефолтно даёт 2
})

it('search source still gates on keywords (unchanged)', async () => {
  const d = deps()
  d._m.set('connect:settings', { searchKeywords: '' })
  const res = await runConnectStep(d) // default source 'search'
  expect(res.reason).toBe('no_keywords')
  expect(d.navigate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Прогон — падает**

Run: `npx vitest run src/service-worker/connectHandlers.test.ts -t "pymk source"`
Expected: FAIL (opts не поддерживается)

- [ ] **Step 3: Реализовать параметр** (`connectHandlers.ts`) — добавить `export const PYMK_URL = 'https://www.linkedin.com/mynetwork/grow/'`; сигнатура `runConnectStep(deps, opts: { source?: 'search' | 'pymk' } = {})`; заменить блок keywords+navigate:

```ts
  const source = opts.source ?? 'search'
  let url: string
  if (source === 'pymk') {
    url = PYMK_URL // PYMK is keyword-free — LinkedIn curates the list
  } else {
    const { searchKeywords, targetRegions } = await loadConnectSettings(deps.store)
    if (!searchKeywords.trim()) return { executed: 0, skipped: 0, reason: 'no_keywords' }
    url = peopleSearchUrl(searchKeywords, geoUrnsForRegions(targetRegions))
  }
  const navOk = await deps.navigate(url)
  if (!navOk) return { executed: 0, skipped: 0, reason: 'nav_failed' }
```

- [ ] **Step 4: Прогон — зелёный** (pymk + search + все прежние)

Run: `npx vitest run src/service-worker/connectHandlers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service-worker/connectHandlers.ts src/service-worker/connectHandlers.test.ts
git commit -m "feat(connect): runConnectStep source param (search|pymk)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `runConnectWithFallback` + reason-метки + SW-разводка

**Files:**
- Modify: `src/service-worker/connectHandlers.ts` (`runConnectWithFallback`)
- Modify: `src/lib/autopilot/reasonLabels.ts` (+ метка `pymk_dry`) + test
- Modify: `src/service-worker/index.ts` (runConnectsThen зовёт fallback, PYMK-deps)
- Test: `src/service-worker/connectHandlers.test.ts`

**Interfaces:**
- Consumes: `runConnectStep(deps, opts?)`, `pymkHarvest` (SW: `harvestPymkFrom`).
- Produces: `runConnectWithFallback(deps: FallbackDeps): Promise<ConnectStepResult>` где `FallbackDeps = ConnectDeps + { pymkHarvest: () => Promise<HarvestResult> }`.

- [ ] **Step 1: Написать падающие тесты** (`connectHandlers.test.ts`):

```ts
const noHarvest = async () => ({ candidates: [] as PersonCandidate[], outcome: 'empty' as const })

it('runs PYMK fallback when search yields 0 connects', async () => {
  const d = deps({ harvest: vi.fn(noHarvest) }) // search пуст
  const pymkHarvest = vi.fn(async () => ({ candidates: [cand('7'), cand('8')], outcome: 'ok' as const }))
  const res = await runConnectWithFallback({ ...d, pymkHarvest, nextPage: vi.fn(async () => false) })
  expect(pymkHarvest).toHaveBeenCalled()
  expect(d.navigate).toHaveBeenCalledWith('https://www.linkedin.com/mynetwork/grow/')
  expect(res).toMatchObject({ executed: 2, reason: 'done' })
})

it('does NOT run PYMK when search already connected someone', async () => {
  const d = deps() // harvest дефолтно 2 connectable
  const pymkHarvest = vi.fn(noHarvest)
  const res = await runConnectWithFallback({ ...d, pymkHarvest })
  expect(pymkHarvest).not.toHaveBeenCalled()
  expect(res.executed).toBe(2)
})

it('does NOT run PYMK when the module is disabled or budget is 0', async () => {
  const d = deps({ harvest: vi.fn(noHarvest) })
  d._m.set('modules:state', [{ id: 'smart_connect', enabled: false, available: true, automationLevel: 'manual', dailyLimit: 100 }])
  const pymkHarvest = vi.fn(noHarvest)
  const res = await runConnectWithFallback({ ...d, pymkHarvest })
  expect(pymkHarvest).not.toHaveBeenCalled()
  expect(res.reason).toBe('disabled')
})

it('reports pymk_dry when both search and PYMK yield 0', async () => {
  const d = deps({ harvest: vi.fn(noHarvest) })
  const pymkHarvest = vi.fn(noHarvest)
  const res = await runConnectWithFallback({ ...d, pymkHarvest, nextPage: vi.fn(async () => false) })
  expect(res).toMatchObject({ executed: 0, reason: 'pymk_dry' })
})
```

- [ ] **Step 2: Прогон — падает**

Run: `npx vitest run src/service-worker/connectHandlers.test.ts -t "fallback"`
Expected: FAIL (функции нет)

- [ ] **Step 3: Реализовать `runConnectWithFallback`** (`connectHandlers.ts`):

```ts
export interface FallbackDeps extends ConnectDeps {
  /** Scroll-harvest PYMK connectable people (the fallback source). */
  pymkHarvest: () => Promise<HarvestResult>
}

/**
 * Smart Connect with PYMK fallback: run the people-search pass; if it connected NOBODY
 * (any reason except module-off / no-budget), top up the remaining connect budget from
 * PYMK (/mynetwork/). Budget/sent-set/history are shared — the PYMK pass re-reads the
 * (unchanged) budget, so the daily/weekly cap bounds search+PYMK together.
 */
export async function runConnectWithFallback(deps: FallbackDeps): Promise<ConnectStepResult> {
  const search = await runConnectStep(deps)
  if (search.executed > 0 || search.reason === 'disabled' || search.reason === 'budget') {
    return search
  }
  const pymk = await runConnectStep(
    { ...deps, harvest: deps.pymkHarvest, nextPage: async () => false },
    { source: 'pymk' }
  )
  if (pymk.executed > 0) return { ...pymk, reason: 'done' }
  return { executed: 0, skipped: 0, reason: 'pymk_dry' }
}
```

- [ ] **Step 4: Прогон — зелёный**

Run: `npx vitest run src/service-worker/connectHandlers.test.ts`
Expected: PASS

- [ ] **Step 5: Метка `pymk_dry`** (`reasonLabels.ts`) + тест (`reasonLabels.test.ts`):

```ts
  pool_pending: 'все в этом поиске уже приглашены — расширь ключи',
  pymk_dry: 'и поиск, и рекомендации LinkedIn исчерпаны — попробуй позже',
```
```ts
    expect(reasonHint('pymk_dry')).toBe('и поиск, и рекомендации LinkedIn исчерпаны — попробуй позже')
```

- [ ] **Step 6: Разводка в `runConnectsThen`** (`service-worker/index.ts`) — заменить `runConnectStep(...)` на `runConnectWithFallback(...)`, добавив `pymkHarvest`:

```ts
  const res = await runConnectWithFallback({
    store, clock, rng,
    navigate: async (url) => {
      const ok = await navigateLinkedInTab(tabId, url)
      await setActivity(SEARCHING_PEOPLE)
      return ok
    },
    harvest: () => harvestPeoplePageFrom(tabId),
    nextPage: () => nextPeoplePageFrom(tabId),
    pymkHarvest: () => harvestPymkFrom(tabId, 30),
    connect: async (c) => {
      await setActivity(CONNECTING)
      return chrome.tabs.sendMessage(tabId, {
        type: 'EXECUTE_ACTION',
        action: { type: 'connect', target: { url: c.profileUrl, meta: { memberId: c.memberId, name: c.name } } }
      }).catch(() => undefined)
    },
    pace: () => contentSleep(tabId, pacer.nextMs(8000, 30000)),
    cancelled
  })
```

- [ ] **Step 7: Билд + весь прогон**

Run: `npm run build`
Expected: без ошибок
Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/service-worker/connectHandlers.ts src/service-worker/connectHandlers.test.ts \
  src/service-worker/index.ts src/lib/autopilot/reasonLabels.ts src/lib/autopilot/reasonLabels.test.ts
git commit -m "feat(connect): PYMK fallback when people-search yields 0 connects

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Live-verify + релиз

**Files:**
- Modify: `package.json` (версия), `CHANGELOG.md`, `README.md`

**Interfaces:** —

- [ ] **Step 1: Билд + load unpacked** — `npm run build`; в `chrome://extensions` Reload/Load `dist/`.

- [ ] **Step 2: LIVE-VERIFY** (аккаунт Влада сейчас CUL-лимичен на поиск → fallback сработает): F5 ленты → «Запустить». Ожидаемо: search-фаза 0 → PYMK-фаза → **реальные инвайты из PYMK** (отзываемые). Проверить отчёт «Коннекты N» (N>0) ИЛИ честную причину. Смотреть SW-консоль на ошибки. Драйвить можно через CDP (real Windows Chrome, порт 9222) — Влад авторизует реальные коннекты.

- [ ] **Step 3: Бамп версии** — новая фича = MINOR: `package.json` `0.8.4` → `0.9.0`. Обновить `CHANGELOG.md` (секция `[0.9.0]`: PYMK-fallback + honest pool_pending) и `README.md` (строка статуса версии + краткое описание).

- [ ] **Step 4: Финальный прогон + билд**

Run: `npm test && npm run build`
Expected: всё зелёное

- [ ] **Step 5: Commit + dual-remote push**

```bash
git add package.json CHANGELOG.md README.md
git commit -m "chore(release): v0.9.0 — PYMK connect-fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
git push github main   # GitHub-зеркало (Влад проверяет синк)
```

---

## Self-Review

**Spec coverage:**
- Триггер (0-результат) → Task 6 (`runConnectWithFallback`). ✓
- Без конфига → нет UI-задачи, fallback встроен в модуль. ✓
- Источник inline `/mynetwork/` → Task 4. ✓
- harvest переиспользование (button) → Task 2. ✓
- Общий бюджет/gate/sent-set → Task 5+6 (двойной вызов runConnectStep перечитывает бюджет). ✓
- Скролл-подгрузка → Task 4 (`pymkScrollHarvest`). ✓
- executeConnect на PYMK + recon → Task 3. ✓
- Reasons/report → Task 6 (`pymk_dry` + `done`). ✓
- TDD (обобщённый селектор, fallback-логика, boundary по HTML) → Tasks 2,4,6. ✓
- honest-reason фикс сворачивается → Task 1. ✓

**Placeholder scan:** Task 3 Step 5-6 условны (зависят от live-recon PYMK connect-flow) — это осознанный recon-then-decide, не placeholder; ветка direct-send специфицирована. Остальное — конкретный код.

**Type consistency:** `HarvestResult`/`PersonCandidate`/`ConnectStepResult` из types+connectHandlers; `runConnectStep(deps, opts?)` и `FallbackDeps` согласованы Task 5↔6; `pymkScrollHarvest`/`harvestPymkFrom`/`HARVEST_PYMK` согласованы Task 4↔6.

**Вне scope V1:** модалка Show All, детект CUL, фильтр по роли, галочка — не запланированы (осознанно).
