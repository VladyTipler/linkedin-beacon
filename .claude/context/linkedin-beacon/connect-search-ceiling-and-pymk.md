# Connect: people-search упёрся в потолок LinkedIn → PYMK как выход (2026-07-13)

## Что показал SW-трейс реального прогона (Влад)
```
START sentSet=158                                   ← Beacon уже отправил 158 инвайтов
nav ok=true …geoUrn=[101174742]                     ← поиск открылся
page=0 outcome=none_connectable connectable=0 members=3   ← всего 3 карточки (норма 10), все Pending
page=0 nextPage=true                                ← пагинатор ЛИСТАЕТ (работает)
page=1 outcome=not_ready connectable=0 members=0    ← стр.2 не отрисовалась (0 карточек)
END executed=0 reason=pool_pending
```
Влад прямо сказал: **«упёрся в лимиты по поиску людей»**.

## Диагноз (подтверждён живым CDP)
- **Commercial-use search limit (CUL)** free-аккаунта. Свежий Canada-поиск сейчас отдаёт **members:3, invite:3** вместо 10, **стр.2 пустая**. LinkedIn ОБРЕЗАЕТ выдачу до ~3 и блокирует пагинацию, когда исчерпан месячный лимит поиска людей. **Явного баннера НЕТ** — детект по тексту ненадёжен; признак = «мало результатов (≤3) + следующая страница not_ready/empty».
- Это **лимит платформы, не баг кода**. Пагинация/гидратация/селектор — все ОК (трейс: nextPage=true, селектор находил invite=3).
- **sentSet=158** — пул «recruiter» + мультирегион реально подистощён прошлыми инвайтами Beacon, сверху CUL.

## Вывод: people-search connect у Влада на потолке
CUL (месячный, копится от Views+Connect+ручного поиска) + 158 sent + сатурация пула. Дальнейший тюнинг харвеста поиска не поможет, пока аккаунт залимичен, и лимит будет рецидивить при активном использовании.

## Решение (идея Влада, подтверждена данными): PYMK-источник
**«People you may know» (`/mynetwork/`)** — ДРУГАЯ поверхность, НЕ под people-search commercial-use limit, курируется LinkedIn, свежий пул (рекрутеры И разработчики). Опт-ин галочка в карточке «Коннекты»: добавлять также из PYMK.
- Ранее PYMK был DEFERRED ([[smart-connect]]): «отражает ТЕКУЩУЮ сеть = CIS-skewed». Теперь берём как ОПЦИЮ (не замена поиску) — Влад согласен на network-skew ради обхода лимита + свежести.
- Плуг в тот же one-button run + connect budget/gate/sent-set. Новая DOM-поверхность → нужен recon `/mynetwork/` (селекторы карточек PYMK + «Connect» кнопки, отличаются от people-search).

## Побочное (honest-reason фикс, held uncommitted)
Готов фикс `not_ready→none_connectable→pool_pending` + пагинация сквозь all-Pending (см. [[connect-pool-saturation-bug]]). Под CUL `pool_pending` слегка врёт (реально «лимит», а не «все приглашены») — при доработке добавить эвристику `search_limited` (мало карточек + next not_ready). Держим до PYMK-работы, коммитить вместе/после.

## Грабли трейса
- Диагностический трейс: `[beacon:connect]` в SW-консоли + продублирован в `chrome.storage.local['connect:trace']` (обёртка `runConnectsThen` в service-worker/index.ts). Влад читает SW-консоль (chrome://extensions → Beacon → service worker → Console) — CDP-readback из sidepanel-таргета через agent-browser НЕ сработал (цепляется к обычной вкладке, не к extension-page).
- Debug Chrome (порт 9222) = реальный профиль Влада с загруженным Beacon (`mcaopdffmgobjbkmmfejfhjhnechmkek`), тот же аккаунт → тоже под CUL сейчас.

## PYMK DOM-recon (live, 2026-07-13, `/mynetwork/grow/`, read-only)
Список: `https://www.linkedin.com/mynetwork/grow/`, секция «People you may know based on your recent activity»; «Show All» → модалка с полным списком (Влад).

**Ключевое отличие от people-search:** Connect-контрол — **`<button>`, НЕ `<a>`**. Всё остальное идентично:
- Connect: `button[aria-label^="Invite "][aria-label$=" to connect"]` (people-search — `a[...]`). Обобщить harvest: `[aria-label^="Invite "][aria-label$=" to connect"]` (tag-agnostic) ловит оба.
- componentkey: `ConnectButtonstate:invitation:urn:li:member:<id>_connect` — **ТОТ ЖЕ формат** → memberId `urn:li:member:<id>`, sent-set совместим.
- aria: `«Invite <name> to connect»` — тот же формат (имя = strip `^Invite `/` to connect$`).
- Профиль: `a[href*="/in/"]` внутри карточки (walk up ~10 предков от кнопки до предка с `/in/`).
- Хедлайн/имя: в тексте карточки (пример: «Nadejda Pîrțac · Specialist Resurse Umane · Veronica and 20 other mutual connections · Connect»).
- Реально видно 8 connectable inline; секции когортные («X's connections you may know»).

**Итог для реализации:** `harvestPeople` расширить на `button` (или tag-agnostic селектор) → переиспользовать для PYMK. Навигация `/mynetwork/grow/` вместо people-search. Модалка Show All — доснять структуру в impl-сессии (чистая вкладка; вероятно те же button+componentkey). Проверить **executeConnect на PYMK**: клик Connect-кнопки шлёт сразу или открывает тот же shadow-модал «Send without a note»? — recon при реализации.

**Грабли recon:** agent-browser при нескольких вкладках в одном CDP рассинхронивается (screenshot/click попадают в ЧУЖУЮ вкладку, eval — в свою). Для PYMK-impl recon: одна чистая вкладка, клики через `eval` (не agent-browser click).

Related: [[connect-pool-saturation-bug]], [[smart-connect]], [[architecture-overview]].
