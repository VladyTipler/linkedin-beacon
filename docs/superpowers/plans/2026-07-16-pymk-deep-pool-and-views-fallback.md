# PYMK Deep-Pool + Views-Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Тянуть PYMK из глубокого пула (Show-all + верный скроллер: 8→92+) для Smart Connect, и добавить PYMK-fallback для Profile Views (top-up при недоборе до дневного лимита).

**Architecture:** Content-харвест PYMK жмёт recent-activity «Show all» и скроллит внутренний overflow-контейнер. `runViewWithFallback` — зеркало `runConnectWithFallback` (runViewStep уже источник-агностичен). Общий бюджет/seen/history.

**Tech Stack:** Chrome MV3, Vue 3.5, TS, Vitest, jsdom. Гексагон.

## Global Constraints
- Файл ≤ 300 строк. SOLID. core (`src/lib`) pure. TDD (тест перед кодом). `npm test` + `npm run build` зелёные перед «готово».
- Content switch над `BeaconMessage` ИСЧЕРПЫВАЮЩИЙ (`assertNever`).
- SSOT: общий бюджет/seen — второго счётчика нет. Direct-to-main. Версия SSOT = `package.json`.
- Селекторы: `docs/linkedin-dom-anchors.md`.

---

### Task 1: Deep-pool PYMK harvest (content) — Show-all expand + correct scroller + profiles flag

**Files:**
- Modify: `src/lib/types.ts` (HARVEST_PYMK += `profiles?`)
- Modify: `src/content/index.ts` (expandPymkShowAll, pymkScroller, HARVEST_PYMK handler)
- Modify: `docs/linkedin-dom-anchors.md`

**Interfaces:**
- Produces: `HARVEST_PYMK { target; profiles? }` — `profiles=true` → all members (Views), else connectable (Connect). Handler expands Show-all + scrolls inner container.

- [ ] **Step 1: `profiles?` в `HARVEST_PYMK`** (`types.ts`):

```ts
  /** SW → content: scroll-harvest PYMK people (/mynetwork/); replies HarvestResult.
   *  profiles=true → ALL members (Views); else connectable only (Smart Connect). */
  | { type: 'HARVEST_PYMK'; target: number; profiles?: boolean }
```

- [ ] **Step 2: Хелперы в `content/index.ts`** (рядом с `feedScroller`/`isPeopleSearchEmpty`). DOM-edge хелперы (как `feedScroller`/`goToNextPeoplePage`) — юнит-тестами не покрываем, live-verified:

```ts
// PYMK «People you may know based on your recent activity»: инлайн ~8; её «Show all»
// раскрывает полный список (~44) НА ТОМ ЖЕ URL. Graceful: нет кнопки → харвест инлайна.
async function expandPymkShowAll(): Promise<void> {
  const showAll = [...document.querySelectorAll<HTMLElement>('a,button')].find((e) =>
    /you may know based on your recent activity/i.test(e.getAttribute('aria-label') ?? '')
  )
  if (!showAll) return
  showAll.click()
  await sleep(2000) // дать раскрытому списку отрисоваться до харвеста
}

// Раскрытый PYMK-список скроллит ВНУТРЕННИЙ overflow-контейнер (как лента), НЕ окно.
// Скролл окна = no-op (это и был баг «берёт только инлайн 8»). Ищем scrollable-ancestor
// connect-контрола, чтобы scroll-to-bottom догружал (44 → 92+).
function pymkScroller(): Element {
  const anchor = document.querySelector('[aria-label^="Invite "][aria-label$=" to connect"]')
  let node: Element | null = anchor
  while (node && node !== document.body) {
    node = node.parentElement
    if (node && node.scrollHeight > node.clientHeight + 100) {
      const ov = getComputedStyle(node).overflowY
      if (ov === 'auto' || ov === 'scroll') return node
    }
  }
  return document.scrollingElement ?? document.documentElement
}
```

- [ ] **Step 3: Обновить `HARVEST_PYMK` handler** (`content/index.ts`) — заменить текущий case:

```ts
    case 'HARVEST_PYMK': {
      // Expand the recent-activity cohort's "Show all" (8 → ~44), then scroll-harvest its INNER
      // container (~44 → 92+). `profiles`: all members (Views) vs connectable (Smart Connect).
      // Verified live 2026-07-16 (memory-bank: pymk-deep-pool).
      const harvestFn = message.profiles
        ? () => harvestProfiles(document)
        : () => harvestPeople(document)
      void expandPymkShowAll()
        .then(() =>
          pymkScrollHarvest(
            harvestFn,
            async () => { const s = pymkScroller(); s.scrollTop = s.scrollHeight },
            () => sleep(1200),
            message.target
          )
        )
        .then(sendResponse)
      return true // async sendResponse
    }
```

- [ ] **Step 4: Билд (exhaustive switch + типы)**

Run: `npm run build`
Expected: без ошибок (message.profiles типизирован; `harvestProfiles` уже импортирован)

- [ ] **Step 5: Тесты (регресс)**

Run: `npm test`
Expected: PASS (существующие pymkScrollHarvest-юниты не тронуты)

- [ ] **Step 6: dom-anchors doc** — добавить в PYMK-секцию: recent-activity «Show all» (`aria-label` содержит `you may know based on your recent activity`) раскрывает 8→44; список скроллит ВНУТРЕННИЙ overflow-контейнер (не окно) → 44→92+.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/content/index.ts docs/linkedin-dom-anchors.md
git commit -m "feat(connect): PYMK deep-pool harvest — expand Show-all + inner scroller (8->92+)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `runViewStep` pace-on-success + `runViewWithFallback` (viewHandlers)

**Files:**
- Modify: `src/service-worker/viewHandlers.ts`
- Test: `src/service-worker/viewHandlers.test.ts`

**Interfaces:**
- Consumes: `runViewStep(deps: ViewDeps): Promise<ViewStepResult>` (source-agnostic; reason `pool_dry`<cap / `done`=cap). `PYMK_URL` from `./connectHandlers`.
- Produces: `runViewWithFallback(deps: ViewFallbackDeps): Promise<ViewStepResult>`.

- [ ] **Step 1: Pace-on-success тест** (`viewHandlers.test.ts`) — модель по существующим runViewStep-тестам; dwell fail → pace НЕ зовётся:

```ts
it('does NOT pace after a failed dwell (only real views get the anti-ban wait)', async () => {
  const d = deps({ dwell: vi.fn(async () => ({ ok: false })) }) // adapt to the file's deps() helper
  await runViewStep(d)
  expect(d.pace).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Прогон — падает** (сейчас паузит всегда)

Run: `npx vitest run src/service-worker/viewHandlers.test.ts -t "failed dwell"`
Expected: FAIL

- [ ] **Step 3: Pace-on-success фикс** (`viewHandlers.ts`, view-loop) — `await deps.pace()` → условный:

```ts
    if (r?.ok) {
      records.push({
        memberId: c.memberId, name: c.name, headline: c.headline,
        profileUrl: c.profileUrl, viewedAt: deps.clock.now().toISOString()
      })
      seen.add(c.memberId)
    }
    // Pace ONLY after a real view — не паузим 8-30с после неудачного dwell (иначе «бесконечные паузы»).
    if (r?.ok) await deps.pace()
```

- [ ] **Step 4: Прогон — зелёный**

Run: `npx vitest run src/service-worker/viewHandlers.test.ts`
Expected: PASS

- [ ] **Step 5: Падающие тесты `runViewWithFallback`** (зеркало connect-fallback):

```ts
describe('runViewWithFallback', () => {
  const dryPage = async () => ({ candidates: [] as PersonCandidate[], outcome: 'empty' as const })
  // deps() below = the file's existing ViewDeps builder; it must expose searchUrl/harvestPage/nextPage/_m.

  it('tops up from PYMK when the search pass under-delivered (pool_dry)', async () => {
    const d = deps({ harvestPage: vi.fn(dryPage) }) // search finds nobody fresh
    const pymkHarvestPage = vi.fn(async () => ({ candidates: [cand('7'), cand('8')], outcome: 'ok' as const }))
    const res = await runViewWithFallback({ ...d, searchUrl: d.searchUrl, searchHarvestPage: d.harvestPage, searchNextPage: d.nextPage, pymkHarvestPage })
    expect(pymkHarvestPage).toHaveBeenCalled()
    expect(res.executed).toBe(2)
  })

  it('does NOT run PYMK when the search pass filled the cap (reason done)', async () => {
    const d = deps() // default harvestPage returns >= cap fresh → done
    const pymkHarvestPage = vi.fn(dryPage)
    const res = await runViewWithFallback({ ...d, searchUrl: d.searchUrl, searchHarvestPage: d.harvestPage, searchNextPage: d.nextPage, pymkHarvestPage })
    expect(pymkHarvestPage).not.toHaveBeenCalled()
  })

  it('does NOT run PYMK when disabled/budget/cancelled', async () => {
    const d = deps({ harvestPage: vi.fn(dryPage) })
    d._m.set('modules:state', [{ id: 'profile_views', enabled: false, available: true, automationLevel: 'manual', dailyLimit: 40 }])
    const pymkHarvestPage = vi.fn(dryPage)
    const res = await runViewWithFallback({ ...d, searchUrl: d.searchUrl, searchHarvestPage: d.harvestPage, searchNextPage: d.nextPage, pymkHarvestPage })
    expect(pymkHarvestPage).not.toHaveBeenCalled()
    expect(res.reason).toBe('disabled')
  })

  it('runs PYMK-only when there are no keywords (searchUrl null)', async () => {
    const d = deps()
    const pymkHarvestPage = vi.fn(async () => ({ candidates: [cand('9')], outcome: 'ok' as const }))
    const res = await runViewWithFallback({ ...d, searchUrl: null, searchHarvestPage: d.harvestPage, searchNextPage: d.nextPage, pymkHarvestPage })
    expect(pymkHarvestPage).toHaveBeenCalled()
    expect(res.executed).toBe(1)
  })
})
```

(Adapt `deps()`/`cand()` to whatever `viewHandlers.test.ts` already defines; if the file lacks a `deps()` helper, model it on `connectHandlers.test.ts`'s.)

- [ ] **Step 6: Прогон — падает**

Run: `npx vitest run src/service-worker/viewHandlers.test.ts -t "runViewWithFallback"`
Expected: FAIL

- [ ] **Step 7: Реализовать `runViewWithFallback`** (`viewHandlers.ts`) — import `PYMK_URL`:

```ts
import { PYMK_URL } from './connectHandlers'

export interface ViewFallbackDeps extends Omit<ViewDeps, 'searchUrl' | 'harvestPage' | 'nextPage'> {
  /** People-search URL, or null when there are no keywords (skip straight to PYMK). */
  searchUrl: string | null
  searchHarvestPage: () => Promise<HarvestResult>
  searchNextPage: () => Promise<boolean>
  /** Single-shot scroll-harvest of PYMK profiles (the fallback source; nextPage is false). */
  pymkHarvestPage: () => Promise<HarvestResult>
}

/**
 * Profile Views with PYMK top-up: run the people-search views pass; if it did NOT fill the daily
 * view cap (any reason except disabled/budget/cancelled/done), top up the remaining budget from
 * PYMK (/mynetwork/). Budget + views:seen are shared (the PYMK pass re-reads the budget). Mirrors
 * runConnectWithFallback; runViewStep is already source-agnostic.
 */
export async function runViewWithFallback(deps: ViewFallbackDeps): Promise<ViewStepResult> {
  const common = {
    store: deps.store, clock: deps.clock, rng: deps.rng,
    navigate: deps.navigate, dwell: deps.dwell, pace: deps.pace, cancelled: deps.cancelled
  }
  let search: ViewStepResult = { executed: 0, skipped: 0, reason: 'no_keywords' }
  if (deps.searchUrl) {
    search = await runViewStep({ ...common, searchUrl: deps.searchUrl, harvestPage: deps.searchHarvestPage, nextPage: deps.searchNextPage })
    if (['disabled', 'budget', 'cancelled', 'done'].includes(search.reason)) return search
  }
  const pymk = await runViewStep({ ...common, searchUrl: PYMK_URL, harvestPage: deps.pymkHarvestPage, nextPage: async () => false })
  const executed = search.executed + pymk.executed
  const reason = pymk.executed > 0 ? 'done' : search.executed > 0 ? search.reason : pymk.reason
  return { executed, skipped: search.skipped + pymk.skipped, reason }
}
```

- [ ] **Step 8: Прогон + билд**

Run: `npx vitest run src/service-worker/viewHandlers.test.ts`
Expected: PASS
Run: `npm run build`
Expected: без ошибок

- [ ] **Step 9: Commit**

```bash
git add src/service-worker/viewHandlers.ts src/service-worker/viewHandlers.test.ts
git commit -m "feat(views): runViewWithFallback (PYMK top-up) + pace only on real views

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: SW wiring — `harvestPymkProfilesFrom` + `runViewsThen` uses fallback

**Files:**
- Modify: `src/service-worker/index.ts`

**Interfaces:**
- Consumes: `runViewWithFallback` (Task 2), `harvestPymkFrom` (exists), `HARVEST_PYMK { profiles }` (Task 1).

- [ ] **Step 1: SW wrapper `harvestPymkProfilesFrom`** (`index.ts`, рядом с `harvestPymkFrom`):

```ts
/** Scroll-harvest ALL PYMK members (incl. non-connectable) from /mynetwork/ — the Views source. */
async function harvestPymkProfilesFrom(tabId: number, target: number): Promise<HarvestResult> {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'HARVEST_PYMK', target, profiles: true }).catch(() => null)
  return (r as HarvestResult | null) ?? { candidates: [], outcome: 'not_ready' }
}
```

- [ ] **Step 2: `runViewsThen` → `runViewWithFallback`** — заменить тело (import `runViewWithFallback` вместо/рядом с `runViewStep`; убрать ранний `no_keywords`-возврат — теперь PYMK спасает без ключей):

```ts
async function runViewsThen(tabId: number, cancelled: () => Promise<boolean>): Promise<ModuleOutcome> {
  const rng = new MathRandomRng()
  const pacer = new HumanDelay(rng)
  const settings = await loadConnectSettings(store)
  const searchUrl = settings.searchKeywords.trim()
    ? peopleSearchUrl(settings.searchKeywords, geoUrnsForRegions(settings.targetRegions))
    : null
  const setActivity = (label: string) => setStage(tabId, label)
  const res = await runViewWithFallback({
    store, clock, rng, cancelled,
    navigate: async (url) => {
      const ok = await navigateLinkedInTab(tabId, url)
      await setActivity(VIEWING_PROFILES)
      return ok
    },
    dwell: async () => chrome.tabs.sendMessage(tabId, { type: 'DWELL_PROFILE' }).catch(() => undefined),
    pace: () => contentSleep(tabId, pacer.nextMs(8000, 30000)),
    searchUrl,
    searchHarvestPage: () => harvestProfilesPageFrom(tabId),
    searchNextPage: () => nextPeoplePageFrom(tabId),
    pymkHarvestPage: () => harvestPymkProfilesFrom(tabId, 40)
  })
  await navigateLinkedInTab(tabId, 'https://www.linkedin.com/feed/')
  return { executed: res.executed, reason: res.reason }
}
```

- [ ] **Step 3: Билд + весь прогон**

Run: `npm run build`
Expected: без ошибок (unused `runViewStep` import? — заменить импорт на `runViewWithFallback`; если `runViewStep` больше не используется в index.ts — убрать из импорта)
Run: `npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/service-worker/index.ts
git commit -m "feat(views): wire Views PYMK-fallback into runViewsThen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Live-verify + release v0.10.0

**Files:** `package.json`, `CHANGELOG.md`, `README.md`

- [ ] **Step 1: Билд + load unpacked** — `npm run build`; Reload Beacon.
- [ ] **Step 2: LIVE-VERIFY** (аккаунт под лимитом поиска → оба fallback сработают): F5 ленты → «Запустить». Ожидаемо: **Коннекты 10-15** (из deep-PYMK), **Просмотры** добирают из PYMK (executed ближе к лимиту), без «бесконечных пауз». Проверить отчёт + My Network→Sent (новые Pending). Драйв через CDP (порт 9222) — Влад авторизует.
- [ ] **Step 3: Бамп** — фича = MINOR: `package.json` `0.9.0` → `0.10.0`. `CHANGELOG.md` `[0.10.0]` (deep-PYMK harvest + Views PYMK-fallback + views pace-on-success). `README.md` статус-строка (версия + тесты) + roadmap-строка.
- [ ] **Step 4: `npm test && npm run build`** — зелёное.
- [ ] **Step 5: Commit + dual push**

```bash
git add package.json CHANGELOG.md README.md
git commit -m "chore(release): v0.10.0 — PYMK deep-pool harvest + Views PYMK-fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin main
git push github main
```

---

## Self-Review
- **Spec coverage:** Part A deep-pool (expand+scroller) → Task 1 ✓. Part B Views-fallback → Task 2 (`runViewWithFallback`) + Task 3 (wiring) ✓. profiles-flag → Task 1 (type) + Task 3 (wrapper) ✓. pace-on-success (views) → Task 2 ✓. Live-verify + release → Task 4 ✓.
- **Placeholder scan:** тесты Task 2 помечены «adapt to viewHandlers.test.ts deps()» — осознанно (имплементер сверяется с реальным хелпером файла); код функций конкретен.
- **Type consistency:** `HARVEST_PYMK{profiles}` (T1) ↔ `harvestPymkProfilesFrom` (T3); `runViewWithFallback`/`ViewFallbackDeps` (T2) ↔ вызов в `runViewsThen` (T3); `PYMK_URL` из connectHandlers.
- **Вне scope V1:** другие PYMK-когорты, day-to-day регенерация — не планированы.
