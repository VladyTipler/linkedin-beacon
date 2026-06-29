# Changelog

Все заметные изменения Beacon. Формат — [Keep a Changelog](https://keepachangelog.com/),
версионирование — [SemVer](https://semver.org/). Политика бампа: `docs/versioning.md`.

Версия — единый источник: `package.json` (`manifest.config.ts` читает `pkg.version`).
До `1.0.0`: каждая **новая фича/модуль** (live-verified) = MINOR `0.x.0`; багфикс/UX/honesty/
рефактор/debt = PATCH `0.x.y`. `1.0.0` = весь план Todoist закрыт, нет заглушек/хардкода,
грабли учтены, E2E зелёный.

## [Unreleased]

## [0.6.1] — 2026-06-29

### Fixed
- **Само-вовлечение: бот лайкал и комментил (×3) СОБСТВЕННЫЙ пост.** Авто-опубликованный пост висел
  вверху ленты, а `LikeFilter` не знал владельца. Теперь `readOwnerName` читает владельца из ленты
  (vanity = первый `/in/` self-card → имя из непустого `alt` аватара, verified live), и движок
  пропускает посты, где автор = владелец (`own_post`). Матч по ИМЕНИ иммунен к churn componentkey —
  причине тройного коммента. При неудаче опознания — fail-open + warn.
- **Просмотр профилей делал 0–3 из 40 после серии коннектов.** Views переиспользовал connect-харвестер
  (только кнопка «Invite to connect»), поэтому уже приглашённые («Pending») были невидимы → harvest 0 →
  пагинация не стартовала. Новый `harvestProfiles` берёт людей по member-componentkey (connect + pending),
  тот же numeric memberId (seen-set валиден). Live: 3 → **38 просмотров**, 35 новых уникальных профилей.

### Changed
- **Просмотры листают страницы вглубь до капа СВЕЖИХ.** `harvestPeoplePaginated` получил `isFresh`-предикат:
  считает невиденных к таргету и листает (до 20 страниц), пока не наберёт `cap` непросмотренных или поиск
  не кончится. Честный reason `pool_dry` («свежих профилей меньше лимита») вместо молчаливого `done`.
  Smart Connect не затронут (по-прежнему только коннектабельные). Убран мёртвый `HARVEST_PEOPLE`.

## [0.6.0] — 2026-06-27

### Added
- **Просмотр профилей — модуль (People-пиллар).** Заходит на N целевых профилей/день из people-search
  внутри «Запустить» (дефолт 40/день, переиспользует таргет Smart Connect, тот же анти-бан гейт:
  day-keyed cap + jitter + human pace + seen-set dedup + ready-gate). Подтверждённый research рычаг
  (LinkedIn Help a105145: исходящие просмотры растят «Find the right people»). Карточка в «Модули» +
  split в «Отчётах» + список просмотренных.
- **Аудит профиля (Brand-пиллар) — экран + чистая логика.** `auditProfile()`: official All-Star 7 полей
  (hard, гейтят completeness %) + best-practice усиления (soft, честно помечены как НЕ official).
  Экран построен, но **работает на ДЕМО-данных — реальное чтение профиля отложено отдельным шагом,
  вход с Dash скрыт до готовности** (наивный ридер на живом профиле давал ложные «у тебя нет X»;
  нужен честный статус «не смог проверить» + обработка ротации хеша voyager-метода).

### Changed
- Идеи для контента сортируются новые→старые (свежие сверху).
- `weeklyGoal`: People-пиллар → `profile_views` (research: People = просмотры, не коннекты); честная
  строка relationships (bare-инвайты, без «персонального Note»).

### Removed
- Модуль-заглушка `auto_apply` (Фаза 4 отложена).

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
