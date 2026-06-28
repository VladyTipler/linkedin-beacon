# CDP-навигация даёт артефакты — не доверять для people-search диагностики

**Урок (2026-06-28, ценой ложного фикса):** Диагностика people-search через CDP `Page.navigate` / повторные `chrome.tabs.update` из зондов **ушатывает tab session** → LinkedIn отдаёт garbage (search suggestions / company entities вместо connectable people) → 0 «Invite to connect» anchors → ложный `not_ready`.

**Реальный путь единственный валидный тест:** navigation через extension context (sidepanel/SW) `chrome.tabs.update` ОДИН раз → CS reinjects → `HARVEST_PEOPLE_PAGE` + `EXECUTE_ACTION` через `chrome.tabs.sendMessage`. На реальном пути geo-URL с regions отдаёт connectable people и executeConnect прожимает «Send without a note».

**Что произошло:** Я по CDP-зондам решил что `geoUrn` в URL ломает people-search (0 anchors), убрал geoUrn (7920ce8). Vlad знал что regions работали вчера. Откатил (9f12b25). End-to-end через extension-context → regions + connect работают. Мой фикс был ошибочным.

**Правило:** 
- Не делать выводов о LinkedIn search/SSI DOM по CDP `Page.navigate` — session artefacts.
- Тестировать только через реальный Beacon path (extension-context sendMessage).
- Если зонд даёт 0 / «Receiving end does not exist» / «channel closed» — сначала проверить что CS жив (PING) и вкладка не перегружена повторными nav'ами.
- Суточный/недельный connect cap можно проверять harvest-ом БЕЗ executeConnect (не расходуя кап).

Связано: [[live-testing-cdp]].