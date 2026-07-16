# Авто-отзыв протухших Sent-инвайтов — Design

**Дата:** 2026-07-16 · **Статус:** утверждён (Влад) · **Мишень:** v0.11.0

## Проблема
Непринятые Pending-инвайты >2 нед **портят ранжирование профиля** (гайд §4.3: «если 3 года висят и не добавляют — ты неинтересный»). У Влада **126 висяков**. Beacon шлёт инвайты, но не чистит.

## Решение
Новый шаг «Очистка Sent» в «Запустить» (gated на `smart_connect` enabled — это гигиена коннект-модуля): зайти на `/mynetwork/invitation-manager/sent/`, отозвать инвайты возрастом **≥ порога** (дефолт 14 дней), paced + capped.

### DOM (live-recon 2026-07-16)
- Страница: `https://www.linkedin.com/mynetwork/invitation-manager/sent/`. Счётчик `People (N)`.
- Строка-инвайт: имя `a[href*="/in/"]`, возраст текстом **«Sent X ago»** (minutes/hours/days/weeks/months/years), row-withdraw = **`a[aria-label^="Withdraw invitation sent to "]`** (текст «Withdraw»).
- Клик row-`a` → confirm `[role="dialog"]` → **`button[aria-label^="Withdraw invitation sent to "]`** → строка исчезает.
- Список **newest-first** → протухшие внизу, нужен scroll-load (verified: свежие «59 minutes ago» сверху).

### Core (pure, unit-tested) — `src/lib/connect/inviteAge.ts`
- `parseInviteAgeDays(sentText: string): number` — «Sent N minutes/hours ago»→0; «N days»→N; «N week(s)»→N*7; «N month(s)»→N*30; «N year(s)»→N*365; нераспознанное→0 (не трогаем).
- `isStaleInvite(sentText: string, maxAgeDays: number): boolean` = `parseInviteAgeDays >= maxAgeDays`.

### Content — `WITHDRAW_STALE_SENT { maxAgeDays; cap }`
Цикл (SW `await`ит ответ → SW жив, как SLEEP-паттерн): scroll-load к старым → найти первую строку со stale-возрастом → click row-withdraw `a` → click confirm dialog button → дождаться удаления → count++ → **пейс (sleep 3-8с)** → повтор, пока `count < cap` ИЛИ нет stale. Re-query каждую итерацию (DOM сдвигается после отзыва). Вернуть `{ withdrawn: number }`. STOP: проверять `autopilotRunning` между отзывами.
- Новый variant `BeaconMessage`; case в exhaustive switch; SW-обёртка `withdrawStaleFrom(tabId, maxAgeDays, cap)`.

### SW — `runWithdrawThen(tabId)` + шаг в `launch()`
Если `smart_connect` enabled → `navigateLinkedInTab(sent-url)` → `withdrawStaleFrom(tabId, 14, 15)` → вернуть в feed. Порядок: **перед** `runConnectsThen` (чистим, потом добираем новых). Отчёт: «Очистка Sent: N отозвано» (отдельная строка или в connect-outcome).

## Дефолты
Порог **14 дней** (≈2 недели), cap **15/прогон**, пейс **3-8с**. (Anti-ban: много быстрых отзывов = бот; capped+paced.)

## Настройки
V1 — константы (14/15). Опционально позже — в карточку «Коннекты» поле порога. (YAGNI: старт на константах.)

## TDD
- **Unit** `parseInviteAgeDays`/`isStaleInvite`: minutes/hours/days/weeks/months/years + границы (1 week=7<14 keep; 2 weeks=14 withdraw; 1 month withdraw); нераспознанное→0 (safe, не отзываем).
- **Content** DOM-цикл — live-verified (как `goToNextPeoplePage`, юнит-тестом не покрываем).
- **Live-verify:** прогон отзывает N старых висяков (у Влада 126), не трогает свежие, cap/пейс соблюдены.

## Вне scope V1
- Настраиваемый порог в UI (константы). Отзыв не-Beacon инвайтов — включается автоматически (парсим Sent-страницу, не ConnectHistory → чистит ВСЕ висяки).

## Связанное
memory-bank: `ssi-guide-roadmap` (#1), `smart-connect`, `connect-search-ceiling-and-pymk`.
