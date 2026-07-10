# Gotcha — комментарии «кучей под одним постом» = findSubmit escape к соседу (fixed 2026-07-10)

## Симптом
Иногда под ОДНИМ постом ленты появляется несколько (до 5) комментов от бота. **Текст РАЗНЫЙ**, всё **в ОДНОМ прогоне**. (Не путать со старым «self-liked+commented ×3» на своём посте — то про owner-filter, 2026-06-29.)

## Разводка (важно для диагностики)
- Разный текст → НЕ повторный submit (был бы одинаковый), НЕ мульти-loop с одинаковым драфтом.
- Один прогон → НЕ кросс-прогонный дедуп (`alreadyLiked` через DOM работает).
- Single loop (crxjs: повторный `import()` модуля кэшируется в isolated world → нет второго listener'а/loop'а; общий `autopilotRunning` guard). Значит 5 РАЗНЫХ комментов от ОДНОГО loop'а валятся на ОДИН пост.

## Корень
`executeComment` скоупит РЕДАКТОР к своему посту (`findByUrn` — корректно). Но `findSubmit(editor)` шёл ВВЕРХ на 8 уровней и на каждом фильтровал `!b.disabled`. Submit ТЕКУЩЕГО поста коммитится асинхронно (ProseMirror MutationObserver) → пару тиков `disabled`. Пока он disabled, walk проскакивал уровень своего box'а и доходил до общего feed-предка, где `querySelectorAll('button')` находил ВКЛЮЧЁННЫЙ submit ЧУЖОГО открытого редактора (предыдущий пост, чей composer не закрылся) → `submit.click()` постил текущий коммент под ЧУЖОЙ пост. За прогон разные комменты копились на первом «залипшем» посте.

Механизм воспроизведён юнит-тестом: два открытых `.comment-box` под общим предком, submit A enabled + submit B disabled → `findSubmit(editorB)` возвращал submit **A**.

## Фикс (v0.8.4)
`findSubmit`: собирать submit-кнопки (по textContent `comment|post|reply`) **включая disabled**. ПЕРВЫЙ предок, где есть хоть одна — это свой comment-box → СТОП. Если свой submit ещё disabled → вернуть `null` (caller `waitForValue` поллит СВОЙ box до enable, макс 4с; иначе `submit_not_found` — коммента нет). Никогда не уходить выше к чужому box'у.
**Инвариант:** коммент уходит либо под ПРАВИЛЬНЫЙ пост, либо никуда — никогда под чужой.

Тесты: `src/content/domActions.test.ts` — «never escapes to a SIBLING post submit while disabled» + «returns THIS box submit once it enables».

## Не проверено вживую
Env был флаки (тонкий debug-фид, активные прогоны уводили вкладку). Баг перемежающийся (нужны залипшие редакторы + окно disabled). Верификация — юнит-тест воспроизводит точный механизм. Живой repro на здоровом фиде — TODO при случае. Возможное усиление: закрывать/blur редактор после submit (против накопления открытых box'ов) — не требуется для корректности после этого фикса.

Related: [[gotchas]], self-engagement-and-views (owner-filter), [[ideas-catchup-regression]].
