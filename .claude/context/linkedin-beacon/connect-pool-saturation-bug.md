# Gotcha — Connect 0 / «страница не успела загрузиться» = пул исчерпан Pending'ами (2026-07-13)

## Симптом
Стандартный прогон: Лайки 17, Посты 1, **Просмотры 7** (pool_dry), **Коннекты 0 — «страница не успела загрузиться» (`not_ready`)**. «Раньше работало, перестал добавлять рекрутеров».

## Корень (подтверждён ЖИВЫМ DOM через CDP, 2026-07-13)
Поиск Влада = `keywords=recruiter` + **несколько регионов** (multi-geoUrn). За недели прогонов Влад **пригласил почти всех** в верхушке своей выдачи → они теперь **Pending**.
- **Страница 1** его multi-region поиска: `members:10, pending:7, inviteAnchors:0` (гидратировано, стабильно 18с) → **0 connectable**.
- **Страница 4** (чистая вкладка, 60с): `members:10, pending:6, inviteAnchors:1` → connectable редкие, ~1/страница.
- `connectKeys == inviteAnchors` (0 и 1) → **дрейфа селектора НЕТ**. Форматы актуальны: connect = `a[aria-label="Invite <name> to connect"]` componentkey `…urn:li:member:<id>_connect`; pending = `aria-label="Pending, click to withdraw invitation sent to <name>"` componentkey `…_pending`.
- geoUrn (одиночный И multi) **возвращает людей** — НЕ ломает поиск (опровергает старую гипотезу 7920ce8/9f12b25; тот not_ready был этим же багом, не geoUrn).

## Механизм бага (2 дефекта, оба чинить)
1. `harvestPeoplePage` (harvestPeople.ts): при 0 connectable-якорях, но НЕ «No results» — возвращает **`not_ready`**, конфляция «страница не отрисовалась» с «отрисована, но все Pending». Причина ВРЁТ.
2. `runConnectStep` (connectHandlers.ts:94-95): на `not_ready`/`empty` от ЛЮБОЙ страницы **сразу `return`** — НЕ пагинирует на стр.2-5, где есть редкие connectable. Пул насыщен на первой странице → 0 навсегда.

**Почему Views живут:** `harvestProfiles` берёт ВСЕХ по componentkey (вкл. Pending) + `harvestPeoplePaginated` идёт до 20 страниц. Connect берёт только `a[aria-label*="Invite…to connect"]` + бросает на первой не-ok странице.

## Фикс (направление, TDD)
- `harvestPeoplePage`: новый outcome **`none_connectable`** — когда люди гидратированы (harvestProfiles>0), но 0 connectable. Guard от false-skip при прогрессивной гидратации: заключать none_connectable только когда счётчик людей УСТОЯЛСЯ (не растёт), не по первому появлению.
- `runConnectStep`: на `none_connectable` **пагинировать дальше** (continue, не return), собирая редкие connectable до CONNECT_MAX_PAGES. Genuine `not_ready`(не отрисовалась)/`empty`(No results) — по-прежнему стоп. Если ВСЕ страницы none_connectable → честная причина (напр. `pool_pending` / «все уже приглашены — расширь ключи»).
- Гидратация action-кнопок ЛЕНИВАЯ (~10с single, дольше multi): componentkey живёт на кнопке → `harvestProfiles>0` ⟺ кнопки гидратированы. Держать это как сигнал.

## Грабли recon'а
- **Частая CDP-навигация деградирует сессию вкладки**: та же стр.1, что давала members:10, после ~6 навигаций стала давать 0. Лечение: новая вкладка (`curl PUT /json/new` + `/json/activate/<id>`) + ждать 60с. НЕ закрывать Chrome (правило Влада). Ровно то, о чём предупреждал revert 9f12b25.
- Баннер «you might benefit from unlimited search» — мягкий commercial-use nudge, показан всегда free-аккаунту, НЕ hard-limit.

Related: [[smart-connect]], [[connect-keywords-persist-gotcha]], [[gotchas]], [[verify-the-fixed-path]], [[dont-silently-flip-safety-behavior]].
