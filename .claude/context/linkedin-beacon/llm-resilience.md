# LLM provider resilience + Gemini free-tier reality (2026-07-03, v0.8.1)

## Gemini free-tier limits — measured empirically (не догадка)
- **`gemini-2.5-flash` free tier = 5 запросов/МИНУТУ + 20 запросов/ДЕНЬ** (RPD сброс в полночь PT).
  Прочитано прямо из тела 429: `"limit: 5, model: gemini-2.5-flash"`, `"Please retry in 21.8s"`.
- Один автопрогон Beacon = **~6 LLM-вызовов** (1 идеи-извлечение + до `commentsPerDay`=5 комментов;
  `CommentJudge` ЛОКАЛЬНЫЙ, без LLM; лайки/коннекты/просмотры/публикация — DOM, без LLM; драфты — вручную).
  → 6 быстрых вызовов рвут 5/мин на 6-м; 20/день = ~3 прогона/сутки.
- **Retry НЕ победит квоту** (RPD до полуночи; RPM-окно скользящее — даже выждав advised 47с, снова 429).
- **Платный ключ:** rapid 10× = 10×200, реальный `GENERATE_DRAFT` через полный стек → валидный текст.
  Значит код-путь Gemini (`GeminiProvider`→`:generateContent`→mapper→parse) **100% корректен**;
  на free ломала ТОЛЬКО квота. gemini-3.5-flash через `:generateContent` тоже работает.
- **Продукт:** цель Влада — free-tier для юзеров без платного LLM. Вывод: `gemini-2.5-flash` (20/день)
  для этого непригоден. Рычаги: (а) free-модель с бóльшим RPD (`2.0-flash-lite`/`2.5-flash-lite` —
  замерить в AI Studio `https://aistudio.google.com/rate-limit`, доки Google цифры больше не публикуют);
  (б) пейсинг ≥12с (лечит только 5/мин, не 20/день); (в) OpenRouter-free как альтернативный бесплатный путь.
  Лимиты — **на проект/ключ, не пулятся** (BYOK → у каждого юзера своя квота). OpenRouter = основной для прогонов.

## Retry-слой (v0.8.1) — что уже есть
- `src/lib/http/HttpError.ts`: `HttpError{status, retryAfterMs}` + `parseRetryAfterMs` (читает `Retry-After`
  заголовок ИЛИ «retry in Xs»/«retryDelay» из ПОЛНОГО тела — подсказка лежит дальше 300-симв. среза message).
- `src/lib/llm/retry.ts`: `withRetry` ретраит 429/5xx, уважая server-advised delay, иначе экспонента+jitter;
  кап `maxDelayMs`=30с → при большем advised (реальная квота) сразу throw (честная ошибка, без пустого столла). Pure/injectable.
- `src/lib/llm/RetryingLlmProvider.ts`: декоратор, оборачивает ВСЕ провайдеры в `createLlmProvider` (и OpenRouter).
- `FetchHttpClient` теперь бросает типизированный `HttpError` (3 места объединены в `fail()`).
- **Нереализованное предложение (Влад пока не решил):** ретраить только 5xx, а на 429 — мгновенная понятная
  ошибка + friendly-message «Gemini free-tier лимит исчерпан (5/мин или 20/день) → OpenRouter». На daily-quota
  текущий retry-429 просто зря ждёт до ~90с. Сделать, если возвращаемся к free-tier-для-всех.

## Грабли сессии
- **Live-verify гоняй именно тот путь, что чинишь.** Критический баг: `refreshMetricsIfDue()` звал сам себя
  (мой `replace_all` заменил строку ВНУТРИ helper'а) → stack overflow во ВСЕХ авто-рефрешах; FORCE_REFRESH шёл
  в обход → первый live-check это замаскировал. Поймал только xhigh code-review. См. [[verify-the-fixed-path]] (built-in).
- **Guard для «STOP во время прогона» не должен ломать автономный путь.** `harvestByScrolling` имел
  `if(!autopilotRunning) break` (для STOP в прогоне) → ручная «Сгенерировать идеи» без прогона (autopilotRunning=false)
  рвалась на round 0 → 0 постов → `no_feed` → «Открой вкладку ленты». Фикс v0.8.2: вынес в тестируемый
  `lib/feed/scrollHarvest` с инъекцией `shouldAbort` (дефолт — не прерывать); прогон передаёт `()=>!autopilotRunning`.
- **`chrome.tabs.reload`/`chrome.tabs.update` = безопасная навигация** (ими и живёт расширение); CDP `Page.navigate`
  портит LinkedIn-сессию (см. [[cdp-nav-artefacts]]). Панель после `chrome.runtime.reload()` НЕ переоткрывается —
  драйвить через panel-as-tab `Target.createTarget(chrome-extension://…/src/sidepanel/index.html)`.

Related: [[profile-views-incoming]], [[gotchas]], [[cdp-nav-artefacts]], [[architecture-overview]].
