# Gotcha — run-end idea catch-up was DEAD CODE (regression from c4981e5, fixed 2026-07-09)

## Симптом
Прогон лайкает, но **идеи для постов не извлекаются** (и `ideas:lastRun` не обновляется — застревает на дате последнего «удачного» прогона). Комменты при этом — отдельная вероятностная история (roll 1/3 на лайк), НЕ баг.

## Корень
`src/content/index.ts` runAutopilotLoop, `finally` catch-up извлечения идей был под гейтом `if (autopilotRunning && wantIdeas && !extractedThisRun)`. Но `endRun()` (стр. ~170) ставит `autopilotRunning=false` ДО того, как `finally` его читает, а КАЖДЫЙ конец прогона идёт через `endRun`/сброс флага. → `autopilotRunning` в `finally` **всегда false** → catch-up = **мёртвый код**. Идеи извлекались только mid-run путём при **`IDEA_TARGET=25`** уникальных постов в буфере — обычный фид столько редко даёт (особенно с dedup по FeedAccumulator). Короткий/средний прогон (<25 уник.) → идей нет.

**Регрессия:** guard добавлен коммитом **c4981e5 (28 июня, «fix: STOP stops immediately + comment submit poll»)** — тот фикс хотел «не сканировать/не звать LLM после Стопа», но `autopilotRunning` не различает user-STOP и естественный `feed_exhausted` (оба зануляют флаг). Убил catch-up для всех концов.

## Почему нельзя было просто убрать guard
SW-обработчик `EXTRACT_RUN_IDEAS` оборачивает извлечение в `withPageActivity` → снова зажигает оверлей «Генерирую идеи». Извлечение ПОСЛЕ user-STOP → «сканирую после Стопа» (тот самый баг c4981e5). Значит на user-STOP catch-up ДОЛЖЕН пропускаться.

## Load-bearing факт (проверен трассировкой SW)
`STOP_AUTOPILOT` — **НЕ** дискриминатор user-stop: `stopAutopilot()` (единая воронка) шлёт его в таб на ВСЕХ концах — `AUTOPILOT_ENDED`(feed_exhausted, стр.403), MAY_ACT decision-stop (budget/risk, стр.421), user (стр.395). Настоящий дискриминатор — **reason**: `gatekeeper.decide` даёт `budget|risk|manual`, где `manual` = user-stop (`manualStop`) или !running-путь.

## Фикс (v0.8.x, 2026-07-09) — loop-local `extractAtEnd`
Флаг ставит ТОЛЬКО синхронный код цикла в точках естественного конца:
- `feed_exhausted` (like-цикл + content-only) → `extractAtEnd = true`.
- decision-stop → `if (decision.reason !== 'manual') extractAtEnd = true` (budget/risk извлекают, user manual — нет). Тип decision расширен `reason?: StopReason`.
- `finally`: `if (extractAtEnd && wantIdeas && !extractedThisRun)`.
Пользовательский STOP выходит через while-условие (async `STOP_AUTOPILOT` зануляет `autopilotRunning`), НЕ задевая natural-end точки → `extractAtEnd=false` → skip. Флаг пишется только синхронно → async-echo `STOP_AUTOPILOT` не может его перезаписать (гонки нет).

## Live-verify (CDP, debug-профиль)
До: `ideas:lastRun.at` застрял на 7 июля. После фикса+reload+F5: прогон → `feed_exhausted` → `ideas:lastRun.at` перескочил на **сегодня** (reason `thin_feed`, т.к. debug-фид дал 3 поста <5). Флип даты = catch-up ожил. На здоровом фиде (≥5) будет `ok`.

## Тесты
Loop (`runAutopilotLoop`) — impure edge (chrome+document+harvest), unit-харнесса нет. Pure-хелпер тут дал бы ложное покрытие (баг stateful, не булев). Реальная проверка — **live-verify через CDP** (flip `ideas:lastRun`). TODO: поднять loop-тест-харнесс (fake `ask`+harvest, ассерт EXTRACT_RUN_IDEAS на feed-exhaust, но не на mid-pace STOP).

Related: [[content-v2-ux]] (старый IDEA_FLOOR=8 — тот же класс), [[gotchas]], [[verify-the-fixed-path]], [[dont-silently-flip-safety-behavior]].
