# SSI Research — что реально двигает пилларах (pull-сторона)

> Дата: 2026-06-26. Метод: 4 параллельных web-research агента с намеренным перекрытием
> на двух спорных claim'ах (просмотры профилей, Sales Navigator) → независимое подтверждение.
> Цель: отделить **подтверждённое** от **мифов** ПЕРЕД проектированием фич profile-audit и profile-views.

## ⭐ Главный первичный источник

**LinkedIn Help `a105145` — «How Sales Navigator SSI is Calculated»**
https://www.linkedin.com/help/sales-navigator/answer/a105145

Единственный официальный документ, где LinkedIn **называет конкретные input'ы по каждому пиллару**. Все 4 агента независимо вышли на него. Всё остальное в SSI-пространстве — practitioner-инференс, корреляционные claim'ы или SEO-контент, ссылающийся друг на друга.

## Вердикты по спорным вопросам (ради них и был research)

### ✅ GO — Просмотр чужих профилей (outgoing) поднимает SSI
**CONFIRMED (high confidence).** «Profile views» официально перечислен в `a105145` как input пиллара **«Find the right people»**, рядом с «people searches» и «days active». Семантика однозначна: это **ВЫ смотрите** профили проспектов = активное прospecting-поведение. Ни один источник не спорит. Вес одного просмотра LinkedIn не публикует, но факт наличия фактора задокументирован.
→ **Фича «просмотр профилей» (deliverable #3) research-подтверждена.**

### ❌ MYTH — Входящие просмотры (ВАС смотрят) НЕ влияют на SSI
**MYTH (high confidence).** Нет официального подтверждения. Контр-эксперимент Nigel Cliffe (LinkedIn-тренер, 2023): перестал постить 4 недели → входящие просмотры «упали камнем», коннект-реквесты −75%, но **SSI держался на 84**. Причинность обратная: высокий SSI → больше входящих просмотров (следствие активности), не наоборот.
→ Не строить ничего вокруг «нас смотрят». Это маркетинговый фольклор.

### ⚠️ Sales Navigator — НЕ множитель, а инструмент
**PLAUSIBLE.** SN не нужен, чтобы иметь/видеть SSI (дашборд `linkedin.com/sales/ssi` открыт любому free-аккаунту, с 2015-08-03 официально). SN **не добавляет очков за факт владения** — он расширяет surface пиллара 2 (Lead Builder, saved leads, SN-specific searches/views). Практики стабильно сообщают о потолке ~70–80 на free-аккаунте. Шкала одна и та же.
→ **Не строить зависимости от Sales Navigator.** Гоним free-account поведения. Потолок ~75 — честно проговорить.

### ⚠️ SSI официально де-приоритизируется (2025+)
LinkedIn на собственной странице (`business.linkedin.com/sell/resources/SSI`, 2025) пишет: высокий SSI «no longer accurately reflects the modern sales environment» / «doesn't always correlate with measurable sales outcomes», ведёт юзеров к AI Seller Intelligence. **Метрика жива, дашборд открыт, обновляется** — но стратегически LinkedIn её гасит. Для честности фрейминга: SSI — полезный proxy/мотиватор, не вечный KPI.

## Пиллары — что подтверждённо двигает (из `a105145`)

| Пиллар (×25) | CONFIRMED input'ы (official) | Наш модуль |
|---|---|---|
| **Establish your professional brand** | полнота профиля, endorsements received, published articles, follower engagement от long-form | `content` ✓ + **profile-audit (новое)** |
| **Find the right people** | **people searches, profile views (outgoing), days active** (+ SN: Lead Builder, saved leads) | **profile-views (новое)** ⚠ ДЫРА |
| **Engage with insights** | shares, likes, comments, messages sent, InMail response rate, group participation | `engagement` ✓ |
| **Build relationships** | total connections, **acceptance rate ваших реквестов**, messages sent + response rate, senior/internal connections | `smart_connect` ✓ |

### Брэнд: официальный All-Star чек-лист (7 полей — CONFIRMED)
LinkedIn Help `a594698` (https://www.linkedin.com/help/linkedin/answer/a594698) — мера ровно из 3 уровней (Beginner → Intermediate → All-Star), гейт по **7 полям**:
1. Фото профиля
2. Локация (город/регион)
3. Industry (из dropdown)
4. Образование (≥1)
5. Текущая позиция (минимум title)
6. Skills (минимум **5**)
7. About/Summary (непустой)

**НЕ в официальных 7** (но Tier-2 best-practice, конвергенция практиков, НЕ official spec): баннер, recommendations received (3+ soft-target), endorsements (5+ на ключевой скилл), Featured-секция, кастомный URL, прошлые позиции (2+), специфичный headline (не просто должность).
**МИФ:** «7-й шаг = 500+ коннектов» — нет на официальной All-Star странице.

## Ключевые импликации для Beacon

1. **People-пиллар сейчас БЕЗ настоящего рычага.** `weeklyGoal.ts` мапит `people → smart_connect`, но коннекты по research = **Relationships**, не People. People = searches + **profile views** + days active. → Фича profile-views закрывает реальную дыру в покрытии пилларов. (Поправить и lever-map.)
2. **Days active — Pillar 2 input.** Сам факт ежедневного запуска Beacon → плюс к People. Бесплатный выигрыш, стоит проговорить в UI.
3. **Acceptance rate — Pillar 4 input (CONFIRMED).** Smart Connect шлёт BARE-инвайты широкой ЦА → низкий acceptance может **вредить** Relationships. Релевантность таргетинга важна не только для роста сети, но и как фактор SSI. (Запараллелить с честностью: bare ≠ персональный Note — уже в долгах.)
4. **Engagement = DOING, не receiving.** Лайки/комменты, которые ДЕЛАЕМ (Pillar 3) — подтверждено. Получаемая вовлечённость идёт в Brand/контент-качество, не в Insights. Текущий engagement-модуль верен.
5. **Profile-audit статически проверяем** (Brand). 7 official полей = hard-fail, Tier-2 = soft-рекомендации. **НЕ выдавать Tier-2/3 за «LinkedIn-confirmed SSI factors»** — честный фрейминг: official gate vs best-practice.
6. **Потолок ~75 без Sales Navigator** — честно показать, не обещать 100.

## Что осталось чёрным ящиком (не выдумывать)
- Точные веса sub-сигналов внутри пиллара, пороги очков, нормализация по индустрии/сети.
- «90-дневное rolling-окно» — PLAUSIBLE (высокая конвергенция вторичных), но НЕ подтверждено официальной страницей. Daily-обновление — CONFIRMED (team-reporting guide).
- Статистика «45% больше возможностей / 51% чаще выполняют квоту / 78% обходят коллег» — **самоотчёт LinkedIn в маркетинге**, не независимое исследование. Не цитировать как доказательство.
- «SSI влияет на reach контента в ленте» — UNCONFIRMED/миф, LinkedIn никогда официально не связывал.

## Источники (приложены)
- **LinkedIn Help a105145** — официальные input'ы по пилларам: https://www.linkedin.com/help/sales-navigator/answer/a105145
- **LinkedIn Help a594698** — All-Star / Profile Strength (7 полей): https://www.linkedin.com/help/linkedin/answer/a594698
- **LinkedIn Sales Blog (2015-08-03)** — SSI бесплатен для всех: https://www.linkedin.com/business/sales/blog/modern-selling/get-your-score-linkedin-makes-the-social-selling-index-available-for-everyone
- **LinkedIn Sales Solutions** — описания пилларов + де-приоритизация SSI: https://business.linkedin.com/sales-solutions/social-selling/the-social-selling-index-ssi
- **LinkedIn «Less scoring, more selling»** — официальная де-приоритизация: https://business.linkedin.com/sell/resources/SSI
- **Nigel Cliffe — Profile Views Experiment** (контр-эксперимент входящих просмотров): https://www.linkedintraining.co.uk/strategy/profile-views-experiment/
- **Neal Schaffer — SSI (обновл. 2026)** — practitioner-синтез: https://nealschaffer.com/linkedin-ssi-social-selling-index/
- **Teamfluence / contentio.io / Expandi** — practitioner-разборы (Tier-2, без official spec).

## Bottom line
Обе фичи research-подтверждены: **profile-audit (Brand, статически проверяем, official 7 полей)** и **profile-views (People, закрывает реальную дыру, outgoing views = CONFIRMED Pillar-2 input)**. Не строить вокруг входящих просмотров и Sales Navigator. Честно: потолок ~75 без SN, SSI де-приоритизируется LinkedIn'ом — но жив и обновляется daily.
