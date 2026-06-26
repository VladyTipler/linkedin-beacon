# Versioning policy — Beacon

> Установлено 2026-06-26. Держать на контроле в КАЖДОЙ сессии.

## Single source of truth
Версия живёт **только** в `package.json` → `version`. `manifest.config.ts` читает `pkg.version`
(не дублировать). `CHANGELOG.md` — история. Git-тег на релиз — опционально.

## Схема (SemVer, до 1.0.0 — `0.MINOR.PATCH`)

| Что изменилось | Бамп | Примеры |
|---|---|---|
| Новая фича/модуль, **live-verified** (≈ эпик Todoist) | **MINOR** `0.x.0` | profile-views, реальный Inbox, SSI-история, kill-switch, бэкенд-прокси |
| Багфикс / UX-проход / honesty-фикс / рефактор / debt-paydown | **PATCH** `0.x.y` | стале-строки, UX-батчи, simplify |
| Чистая дока / контекст (memory-bank) | без бампа | research, specs |

После `1.0.0` — обычный SemVer: breaking → MAJOR, фича → MINOR, фикс → PATCH.

## Гейт 1.0.0 (определение Влада)
Все одновременно:
- Весь запланированный объём Todoist (проект LinkedIn Beacon) закрыт.
- Нет заглушек/хардкода: Inbox на реальных данных, `auto_apply` построен или выпилен,
  LLM-ключи за бэкенд-прокси (не в расширении).
- Грабли из `gotchas.md` учтены; E2E-прогон в Chrome зелёный.

## Ритуал бампа (часть «завершения фичи», рядом с «тесты+build зелёные, git чистый»)
1. Определить тип (MINOR/PATCH) по таблице.
2. Поднять `package.json` → `version`.
3. Дописать `CHANGELOG.md` (секция версии: Added/Fixed/Changed).
4. Бамп идёт **в финальном коммите фичи** (или отдельным `chore(release): vX.Y.Z`).

## Контроль cross-session
Эта политика + строка в `architecture-overview.md` + built-in memory `versioning-policy`.
Любая сессия, завершая фичу/фикс, ОБЯЗАНА выполнить ритуал бампа.
