# Beacon — LinkedIn SSI Engine

> Safety-first браузерное расширение (Chrome MV3) для роста **LinkedIn SSI** по принципу *pull > push*:
> прокачиваем профиль так, чтобы рекрутёры и клиенты писали сами — а не мы спамим outbound.

**Статус:** v0.8.1 — MVP, live-verified на реальном аккаунте. 528 тестов, билд чистый.
**Демо UI:** https://artifacts.kanev.space/beacon-linkedin-ssi/
**Дизайн-спека:** https://artifacts.kanev.space/beacon-design-spec/

---

## Что делает

Beacon ведёт **один безопасный автоматический прогон** в твоём реальном браузере: прогоняет все включённые модули до их дневного/недельного лимита в human-темпе и отчитывается. Один запуск — walked away.

| Модуль | Что делает | SSI-пиллар |
|---|---|---|
| **Просмотры профилей** | Заходит на **разные, ещё не просмотренные** профили из поиска (включая уже приглашённых), листая страницы до дневного капа свежих, с dwell-паузой (как человек прочитал) | People |
| **Smart Connect** | Добавляет в сеть релевантных людей (без note, per-page, со стопом на лимит) | Relationships |
| **Engagement** | Лайкает посты из ленты + ~⅓ комментирует коротко — мнением или вопросом (1–2 предложения). Никогда не трогает твои собственные посты | Insights |
| **Контент** | Генерирует идеи из ленты → черновик → **твоё одобрение** → авто-публикация по Пн/Ср/Пт | Brand |

Параллельно — **SSI-движок**: тянет реальный балл + 4 столпа + ранги с внутреннего LinkedIn API, раз в сутки и по кнопке. Видно на экране SSI с любой страницы.

На дашборде — две **метрики динамики** (дневные снапшоты, «было → стало»): тренд **SSI** по столпам и **просмотры профиля** (входящие, «кто смотрел вас» за 90 дней) — прямой результат pull-петли. Просмотры — скользящее окно, поэтому спад показывается нейтрально, без ложной тревоги.

### Принципы

- **Pull > push.** Главная метрика — «сколько людей написали тебе», а не «сколько ты запостил». Всё работает на поднятие 4-х пилларов SSI.
- **Safety-first, anti-ban beats speed.** Паузы 8–45с, human-breaks, jitter на лимитах, warmup, плавная деградация при captcha/challenge. Действия — в твоём реальном Chrome-профиле, не bot-detectable Playwright.
- **Human-in-the-loop только где необратимо.** Публикация поста — только после твоего «Одобрить». Лайки/коннекты/просмотры — автономны в безопасном темпе. Бот **никогда не лайкает и не комментит твои собственные посты** (опознаёт владельца по ленте).
- **Один бюджет на модуль.** Лимит = `base ± jitter` (+ warmup), никогда фиксированное число — для правдоподобия.

---

## Стек

Vue 3.5 · TypeScript · Vite 6 · [`@crxjs/vite-plugin`](https://crxjs.dev) · Vitest · Manifest V3 (sidePanel API).

## Установка

### Сборка

```bash
git clone <repo>
cd linkedin-beacon
npm install
npm run build          # vue-tsc --noEmit + vite build → dist/
```

Требуется Node 20+ и Chrome 116+.

### Загрузка в Chrome (unpacked)

1. Открой `chrome://extensions`.
2. Включи **Developer mode** (тумблер справа сверху).
3. **Load unpacked** → выбери папку **`dist/`** (не корень репо!).
4. Закрепи иконку Beacon на тулбаре — клик открывает **сайдбар справа**.

> Для разработки: `npm run dev` держит `dist/` свежим (HMR панели). После правок service worker / content script жми **Reload (⟳)** на карточке расширения.

## Настройка

1. **LLM-ключ.** Beacon использует LLM для генерации идей/черновиков/комментариев. На экране **Контент** (или в настройках) вставь ключ одного из провайдеров:
   - **OpenRouter** (основной) — `Authorization: Bearer`. Рекомендуется (дёшево, выбор моделей).
   - **Gemini** (free tier) — прямой Google API, для тех, кто не хочет платить.

   Ключ хранится только в `chrome.storage.local` на твоей машине — никуда не отправляется, кроме как в API провайдера напрямую с твоего браузера.

2. **Лимиты модулей.** Экран **Модули** = единый конфиг-хаб: вкл/выкл + один лимит на модуль (просмотры/день, коннекты/неделю, лайки/день, посты/неделю) с recommended-подсказкой.

3. **Запуск.** Экран **Dash** → одна кнопка «Запустить». Бот прогоняет все включённые модули автономно, показывает live-этап + счётчики дня, потом отчитывается.

---

## Архитектура

Гексагональная, зависимости направлены внутрь. `core` (pure, 100% unit-tested) не импортирует `chrome`/`document`/`fetch` — только узкие порты (`SsiSource`, `KeyValueStore`, `Clock`, `HttpClient`, `Rng`).

```
src/
├── lib/              # core (pure): ssi/, ssi-api/, feed/, engagement/, views/, connect/, content/, llm/, ideas/
├── adapters/         # тонкие edge-адаптеры (chrome/document/fetch/Date)
├── service-worker/   # MV3 SW — роутер сообщений, оркестратор, gatekeeper, персист
├── content/          # content script — единственный слой в DOM LinkedIn
└── sidepanel/        # Vue-приложение сайдбара
```

Слои: `sidepanel` (UI) → `service-worker` (оркестратор) → `content` (DOM-мост). SW никогда не трогает DOM.

### Источник SSI-данных

- **Primary — внутренний API.** SW дёргает `/sales-api/salesApiSsi` (тот же эндпоинт, что гидрирует `/sales/ssi`) → чистый JSON с баллом, 4 столпами, рангами. Куки сессии браузер прикрепляет сам (`credentials: 'include'` + `host_permissions`). Работает с любой страницы, без визуального мелькания. Раз в сутки + по кнопке.
- **Fallback — DOM-парсер.** Если открыта `/sales/ssi`, content script парсит страницу (`DomSelectorStrategy` → `TextScanStrategy`) — мгновенно и как резерв.

Оба источника возвращают один доменный `SsiSnapshot` — ядро не знает, откуда данные (DIP/OCP).

---

## Разработка

```bash
npm install
npm test               # vitest run (528 тестов)
npm run test:watch     # vitest в watch
npm run typecheck      # vue-tsc --noEmit
npm run build          # typecheck + vite build → dist/
npm run dev            # vite watch (HMR панели)
```

Тестирование интеграций — по контрактам: shape реального ответа LinkedIn API, LLM mappers, DOM-парсер по HTML-фикстуре, chrome-адаптеры с realistic-payload.

## Permissions — что и зачем

Минимум permissions, host-доступ **только к LinkedIn** + API LLM-провайдеров:

| Permission | Зачем |
|---|---|
| `sidePanel` | UI сайдбара |
| `storage` | Локальный персист (состояние, бюджеты, отчёты, LLM-ключ) |
| `scripting`, `tabs` | Запуск прогонов в LinkedIn-вкладке, навигация при пагинации |
| `alarms` | Планировщик авто-публикации |
| `cookies` | Чтение `JSESSIONID` (не-HttpOnly) для `csrf-token` заголовка к SSI API. HttpOnly-куки (`li_at`) НЕ читаются — браузер прикрепляет сам |
| host: `linkedin.com` | Вся автоматизация + SSI |
| host: `openrouter.ai`, `generativelanguage.googleapis.com` | Прямые LLM-вызовы |

Beacon не отправляет твои данные никуда, кроме как в LinkedIn (через твой же браузер) и в LLM API (который ты сам выбрал). Никаких аналитик, телеметрии, third-party эндпоинтов.

---

## Статус и roadmap

**v0.8.0** — Profile Views out (заходит на профили, live-verified) + **Просмотры профиля in** (WVMP-метрика «кто смотрел вас», дневные снапшоты + тренд на дашборде, live-verified: 45/90 дней), **тренд SSI** по столпам (v0.7.0), Smart Connect (per-page, reliable STOP), Engagement (likes + короткие комментарии мнением/вопросом, по одному на пост, без само-вовлечения), Content pipeline v2 (ideas → approve → авто-публикация), SSI-движок.

**Дальше:** реальный reader для аудита профиля (Brand pillar, честное unknown-состояние), E2E-тесты, 1.0.0 gate = все Todoist-задачи закрыты + нет stubs/hardcode.

Подробности: `docs/plans/phase-1.md`, `docs/versioning.md`, `CHANGELOG.md`.

## License

MIT — см. `LICENSE`. Используй на свой риск, в соответствии с условиями использования LinkedIn. Automation tools — серая зона TOS; Beacon спроектирован safety-first именно чтобы минимизировать риски, но решение об использовании за тобой.
