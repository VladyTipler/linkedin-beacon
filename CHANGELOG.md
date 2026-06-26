# Changelog

Все заметные изменения Beacon. Формат — [Keep a Changelog](https://keepachangelog.com/),
версионирование — [SemVer](https://semver.org/). Политика бампа: `docs/versioning.md`.

Версия — единый источник: `package.json` (`manifest.config.ts` читает `pkg.version`).
До `1.0.0`: каждая **новая фича/модуль** (live-verified) = MINOR `0.x.0`; багфикс/UX/honesty/
рефактор/debt = PATCH `0.x.y`. `1.0.0` = весь план Todoist закрыт, нет заглушек/хардкода,
грабли учтены, E2E зелёный.

## [Unreleased]

## [0.5.0] — 2026-06-26

> Ретроспективная сверка версии с реальностью: проект стоял на `0.1.0` с самого init, хотя
> зашипил 5 живых фич-срезов. Версии ниже — приблизительная реконструкция уже сделанного.

### Added
- **Content Pipeline v2** — approve-gate на черновики («Одобрить»/«Отозвать» → `Draft.approved`),
  авто-публикация одобренных как шаг «Запустить» (`publishDays` Пн/Ср/Пт, weekly cap, one/run).
- **ONE-BUTTON consolidation** — единый конфиг-хаб «Модули» + одна «Запустить»↔«Остановить»,
  прогоняющая все включённые модули в безопасном темпе.
- **UX-проход** по всему расширению — per-action фидбэк кнопок, press-affordance,
  «сохранено ✓»/«Скопировано ✓», live-countdown на activity-pill.

### Notes
- Версия теперь честно отражает объём готового. Дальше — по политике бампа.

## [0.4.0] — Content Pipeline v1
- Идеи из ленты → черновики постов; BYOK LLM-слой (`LlmProvider`: OpenRouter + Gemini).

## [0.3.0] — Smart Connect
- People-search → bare-инвайты (multi-region geoUrn), weekly+day-keyed бюджет, sent-set,
  human-pace. Поднимает people + relationships.

## [0.2.0] — Engagement
- Broad-лайки + auto-scroll harvest; judged-комментарии (off-by-default); daily budget +
  human delay; gate (manual/guardrails/full) + quarantine.

## [0.1.0] — Phase 1 SSI engine
- Чтение SSI: internal API (`/sales-api/salesApiSsi`) primary + DOM-парсер `/sales/ssi` fallback;
  фоновый refresh; weekly-goal (слабейший пиллар → рычаг).
