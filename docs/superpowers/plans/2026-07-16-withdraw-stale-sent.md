# Withdraw Stale Sent Invites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Новый шаг «Очистка Sent» в «Запустить» — отзывать непринятые инвайты ≥14 дней (paced, capped), чтобы мёртвые Pending не портили ранжирование.

**Architecture:** Pure age-parser (`inviteAge.ts`) + content DOM-цикл (`WITHDRAW_STALE_SENT`) + SW-шаг `runWithdrawThen` перед connect, счётчик в `smart_connect` outcome (`ModuleOutcome.withdrawn`).

**Tech Stack:** Chrome MV3, Vue 3.5, TS, Vitest, jsdom.

## Global Constraints
- core (`src/lib`) pure. TDD: pure age-parser unit-tested; content DOM-цикл live-verified (как `goToNextPeoplePage`). Content switch ИСЧЕРПЫВАЮЩИЙ (`assertNever`). Direct-to-main. Версия SSOT `package.json`. Selectors → `docs/linkedin-dom-anchors.md`.
- Anti-ban: cap 15/прогон, пейс 3-8с, STOP прерывает.

---

### Task 1: Core — `inviteAge` parser (pure) + tests

**Files:** Create `src/lib/connect/inviteAge.ts`, `src/lib/connect/inviteAge.test.ts`.

**Interfaces:** Produces `parseInviteAgeDays(sentText: string): number`, `isStaleInvite(sentText: string, maxAgeDays: number): boolean`.

- [ ] **Step 1: Падающие тесты** (`inviteAge.test.ts`):

```ts
import { describe, it, expect } from 'vitest'
import { parseInviteAgeDays, isStaleInvite } from './inviteAge'

describe('parseInviteAgeDays', () => {
  it('maps LinkedIn "Sent X ago" buckets to approx days', () => {
    expect(parseInviteAgeDays('Sent 59 minutes ago')).toBe(0)
    expect(parseInviteAgeDays('Sent 1 hour ago')).toBe(0)
    expect(parseInviteAgeDays('Sent 3 days ago')).toBe(3)
    expect(parseInviteAgeDays('Sent 1 week ago')).toBe(7)
    expect(parseInviteAgeDays('Sent 2 weeks ago')).toBe(14)
    expect(parseInviteAgeDays('Sent 1 month ago')).toBe(30)
    expect(parseInviteAgeDays('Sent 3 months ago')).toBe(90)
    expect(parseInviteAgeDays('Sent 1 year ago')).toBe(365)
  })
  it('returns 0 for unrecognized text (safe — never withdraw on doubt)', () => {
    expect(parseInviteAgeDays('')).toBe(0)
    expect(parseInviteAgeDays('Pending')).toBe(0)
  })
})

describe('isStaleInvite (default threshold 14 days)', () => {
  it('keeps < 14 days, withdraws >= 14', () => {
    expect(isStaleInvite('Sent 3 days ago', 14)).toBe(false)
    expect(isStaleInvite('Sent 1 week ago', 14)).toBe(false)   // 7 < 14
    expect(isStaleInvite('Sent 2 weeks ago', 14)).toBe(true)   // 14 >= 14
    expect(isStaleInvite('Sent 1 month ago', 14)).toBe(true)
    expect(isStaleInvite('Sent 59 minutes ago', 14)).toBe(false)
  })
})
```

- [ ] **Step 2: Прогон — падает.** `npx vitest run src/lib/connect/inviteAge.test.ts` → FAIL.

- [ ] **Step 3: Реализация** (`inviteAge.ts`):

```ts
const UNIT_DAYS: Record<string, number> = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 }

/**
 * Approx age (days) of a LinkedIn "Sent X ago" invitation label. LinkedIn buckets to
 * minutes/hours/days/weeks/months/years; we map to a day estimate to compare against a
 * threshold. Unrecognized text → 0 (safe: an unknown age never counts as stale).
 */
export function parseInviteAgeDays(sentText: string): number {
  const m = (sentText || '').match(/(\d+)\s+(minute|hour|day|week|month|year)s?\b/i)
  if (!m) return 0
  return parseInt(m[1], 10) * (UNIT_DAYS[m[2].toLowerCase()] ?? 0)
}

/** True if the invite is at least `maxAgeDays` old (default policy: 14 days ≈ 2 weeks). */
export function isStaleInvite(sentText: string, maxAgeDays: number): boolean {
  return parseInviteAgeDays(sentText) >= maxAgeDays
}
```

- [ ] **Step 4: Прогон — зелёный.** `npx vitest run src/lib/connect/inviteAge.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/connect/inviteAge.ts src/lib/connect/inviteAge.test.ts
git commit -m "feat(connect): invite-age parser for stale-Sent cleanup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Content — `WITHDRAW_STALE_SENT` handler + message + SW wrapper

**Files:** Modify `src/lib/types.ts`, `src/content/index.ts`, `src/service-worker/index.ts`, `docs/linkedin-dom-anchors.md`.

**Interfaces:** Message `{ type: 'WITHDRAW_STALE_SENT'; maxAgeDays: number; cap: number }` → content replies `{ withdrawn: number }`. SW: `withdrawStaleFrom(tabId, maxAgeDays, cap): Promise<number>`.

- [ ] **Step 1: Message variant** (`types.ts`, рядом с HARVEST_PYMK):
```ts
  /** SW → content: withdraw Pending invites older than maxAgeDays (paced, capped). Replies { withdrawn }. */
  | { type: 'WITHDRAW_STALE_SENT'; maxAgeDays: number; cap: number }
```

- [ ] **Step 2: Content DOM-цикл** (`content/index.ts`) — импорт `isStaleInvite` из `@lib/connect/inviteAge`; хелпер + case. DOM-edge (live-verified, без юнита):

```ts
// Sent-invites manager (/mynetwork/invitation-manager/sent/): each row has a withdraw <a>
// (aria "Withdraw invitation sent to <name>", text "Withdraw"); the row text carries "Sent X
// ago". List is newest-first, so stale invites are at the bottom — scroll to load them.
function findStaleWithdraw(maxAgeDays: number): HTMLElement | null {
  for (const a of document.querySelectorAll<HTMLElement>('a[aria-label^="Withdraw invitation sent to "]')) {
    let row: Element | null = a
    for (let i = 0; i < 8 && row && !row.querySelector('a[href*="/in/"]'); i++) row = row.parentElement
    const sent = (row?.textContent?.match(/Sent[^]*?ago/i) ?? [''])[0]
    if (isStaleInvite(sent.replace(/\s+/g, ' ').trim(), maxAgeDays)) return a
  }
  return null
}

async function withdrawStaleSent(maxAgeDays: number, cap: number): Promise<{ withdrawn: number }> {
  let withdrawn = 0
  for (let i = 0; i < cap; i++) {
    if (!autopilotRunning) break
    let target = findStaleWithdraw(maxAgeDays)
    if (!target) {
      const s = document.scrollingElement ?? document.documentElement
      s.scrollTop = s.scrollHeight
      await sleep(2000) // load older rows
      target = findStaleWithdraw(maxAgeDays)
      if (!target) break // no stale invites left
    }
    target.click() // opens the confirm dialog
    const confirm = await waitForValue(
      () => document.querySelector<HTMLElement>('[role="dialog"] button[aria-label^="Withdraw invitation sent to "]'),
      4000
    )
    if (!confirm) continue
    confirm.click()
    withdrawn++
    await sleep(delay.nextMs(3000, 8000)) // human pace + let the row detach
  }
  return { withdrawn }
}
```
Case в switch (перед `assertNever`):
```ts
    case 'WITHDRAW_STALE_SENT':
      void withdrawStaleSent(message.maxAgeDays, message.cap).then(sendResponse)
      return true // async sendResponse
```
(`waitForValue` уже используется в domActions — если не импортирован в content/index, использовать локальный poll через `sleep`; проверить наличие и при отсутствии сделать простой poll-хелпер.)

- [ ] **Step 3: SW wrapper** (`service-worker/index.ts`, рядом с harvest-обёртками):
```ts
/** Withdraw stale Sent invites via the invitation manager; returns how many were withdrawn. */
async function withdrawStaleFrom(tabId: number, maxAgeDays: number, cap: number): Promise<number> {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'WITHDRAW_STALE_SENT', maxAgeDays, cap }).catch(() => null)
  return (r as { withdrawn: number } | null)?.withdrawn ?? 0
}
```

- [ ] **Step 4: Билд (exhaustive switch) + тесты.** `npm run build` (PASS — новый case есть); `npm test` (PASS).

- [ ] **Step 5: dom-anchors doc** — новая секция «Sent-invites manager»: URL, row-withdraw `a[aria-label^="Withdraw invitation sent to "]`, «Sent X ago», confirm `[role="dialog"] button[aria-label^="Withdraw invitation sent to "]`, newest-first (scroll для старых).

- [ ] **Step 6: Commit**
```bash
git add src/lib/types.ts src/content/index.ts src/service-worker/index.ts docs/linkedin-dom-anchors.md
git commit -m "feat(connect): WITHDRAW_STALE_SENT content handler + SW wrapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: SW step `runWithdrawThen` + launch wiring + report count

**Files:** Modify `src/service-worker/index.ts`, `src/lib/types.ts` (ModuleOutcome), `src/lib/autopilot/runOutcomes.ts` + its test, `src/sidepanel/screens/ReportsScreen.vue`.

**Interfaces:** `runWithdrawThen(tabId): Promise<number>`. `ModuleOutcome.withdrawn?: number`. Report shows «Коннекты N · отозвано M».

- [ ] **Step 1: `ModuleOutcome.withdrawn?`** (`types.ts`):
```ts
export interface ModuleOutcome {
  executed: number
  reason: string
  /** Smart Connect only: how many stale Sent invites were withdrawn this run (cleanup step). */
  withdrawn?: number
}
```

- [ ] **Step 2: `runWithdrawThen`** (`index.ts`) — навигация на sent-страницу + withdraw:
```ts
const SENT_URL = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/'
/** Cleanup step: withdraw stale (>=14d) Sent invites. Returns the count. Gated by caller on smart_connect. */
async function runWithdrawThen(tabId: number): Promise<number> {
  if (!(await navigateLinkedInTab(tabId, SENT_URL))) return 0
  await setStage(tabId, CONNECTING) // reuse label; or add a WITHDRAWING label (Step 3b)
  return withdrawStaleFrom(tabId, 14, 15)
}
```

- [ ] **Step 3: launch() wiring** — в connect-блоке, ПЕРЕД `runConnectsThen`, сложить count в outcome:
```ts
      if (tabId && connectEnabled && await isRunning()) {
        try {
          const withdrawn = await runWithdrawThen(tabId)
          const c = await runConnectsThen(tabId, 'https://www.linkedin.com/feed/', isCancelled)
          await recordOutcome('smart_connect', { ...c, withdrawn })
        } catch { await recordOutcome('smart_connect', { executed: 0, reason: 'error' }) }
      } else {
        await recordOutcome('smart_connect', { executed: 0, reason: 'disabled' })
      }
```
(Optional 3b: add a `WITHDRAWING` status label in `statusLabels.ts` + use it in `runWithdrawThen` instead of `CONNECTING`.)

- [ ] **Step 4: Report plumbing** — `buildReportModules` (`runOutcomes.ts`) должен пробросить `withdrawn` в `RunReport.modules[]`; `RunReport.modules` тип (в types.ts) += `withdrawn?: number`. Обновить существующий `runOutcomes.test.ts` (проброс `withdrawn`). Написать тест ПЕРЕД правкой (проброс withdrawn для smart_connect).

- [ ] **Step 5: ReportsScreen render** (`ReportsScreen.vue`) — в строке модуля, если `withdrawn > 0`, показать «· отозвано {{withdrawn}}» рядом с count Коннектов. Визуал — сверить с эталоном (mono, приглушённо, как reason-hint).

- [ ] **Step 6: Билд + весь прогон.** `npm run build`; `npm test` → PASS.

- [ ] **Step 7: Commit**
```bash
git add src/service-worker/index.ts src/lib/types.ts src/lib/autopilot/runOutcomes.ts src/lib/autopilot/runOutcomes.test.ts src/sidepanel/screens/ReportsScreen.vue
git commit -m "feat(connect): run stale-Sent cleanup before connect + report count

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Live-verify + release v0.11.0

- [ ] **Step 1:** `npm run build`; Reload Beacon.
- [ ] **Step 2: LIVE-VERIFY** (у Влада 126 висяков): «Запустить» → шаг «Очистка Sent» отзывает старые (≥2нед), НЕ трогает свежие, cap 15/пейс соблюдены. Отчёт «Коннекты N · отозвано M». Сверить My Network→Sent (счётчик упал). CDP-драйв ок.
- [ ] **Step 3: Бамп** — фича = MINOR `0.10.0` → `0.11.0`; `CHANGELOG` `[0.11.0]`; `README` статус (версия+тесты) + roadmap-строка.
- [ ] **Step 4:** `npm test && npm run build` — зелёное.
- [ ] **Step 5: Commit + dual push** `git push origin main && git push github main`.

---

## Self-Review
- **Coverage:** age-parser → T1; content withdraw loop + message + SW wrapper → T2; step + launch + report → T3; live-verify+release → T4. ✓
- **Placeholders:** T2 Step 2 flags `waitForValue` presence-check (осознанно — проверить импорт); всё остальное конкретно.
- **Types:** `WITHDRAW_STALE_SENT`(T2)↔`withdrawStaleFrom`(T2)↔`runWithdrawThen`(T3); `ModuleOutcome.withdrawn`(T3 S1)↔launch(T3 S3)↔report(T3 S4-5); `isStaleInvite`(T1)↔content(T2).
- **Anti-ban:** cap 15 + pace 3-8s + STOP-check (autopilotRunning) в цикле.
