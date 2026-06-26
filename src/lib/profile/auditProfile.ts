import type { ProfileSnapshot, AuditItem, ProfileAudit } from './contracts'

const EDIT = 'https://www.linkedin.com/in/me/'

/** Build the audit checklist. Tier-1 (official All-Star a594698) gates completeness; Tier-2 is advisory. */
export function auditProfile(s: ProfileSnapshot): ProfileAudit {
  const official: AuditItem[] = [
    item('photo', 'Фото профиля', 'official', s.hasPhoto, 'Добавь профессиональное фото.'),
    item('location', 'Локация', 'official', !!s.location, 'Укажи город/регион.'),
    item('industry', 'Сфера (Industry)', 'official', !!s.industry, 'Выбери отрасль из списка.'),
    item('education', 'Образование', 'official', s.educationCount >= 1, 'Добавь хотя бы одно учебное заведение.'),
    item('current', 'Текущая позиция', 'official', s.hasCurrentPosition, 'Добавь текущее место работы.'),
    item('skills', 'Навыки (≥5)', 'official', s.skillCount >= 5, 'Добавь минимум 5 навыков.'),
    item('about', 'Раздел «О себе»', 'official', !!s.about && s.about.trim().length > 0, 'Заполни раздел About.')
  ]
  const boost: AuditItem[] = [
    item('banner', 'Баннер', 'best-practice', s.hasBanner, 'Добавь фоновый баннер.'),
    item('headline', 'Цепляющий headline', 'best-practice', !!s.headline && s.headline.trim().length > 0,
      'Сделай headline ценностным, не просто должность.'),
    item('recommendations', 'Рекомендации (≥3)', 'best-practice', s.recommendationCount >= 3,
      'Запроси хотя бы 3 рекомендации.'),
    item('featured', 'Раздел Featured', 'best-practice', s.hasFeatured, 'Закрепи лучшие посты/работы в Featured.'),
    item('customUrl', 'Кастомный URL', 'best-practice', s.hasCustomUrl, 'Сделай короткий vanity-URL профиля.'),
    item('pastPositions', 'Прошлый опыт (≥2)', 'best-practice', s.pastPositionCount >= 2,
      'Добавь предыдущие места работы (≥2).')
  ]
  const officialDone = official.filter((i) => i.done).length
  const officialTotal = official.length
  return {
    items: [...official, ...boost],
    completeness: Math.round((officialDone / officialTotal) * 100),
    isAllStar: officialDone === officialTotal,
    officialDone,
    officialTotal
  }
}

function item(key: string, label: string, tier: AuditItem['tier'], done: boolean, hint: string): AuditItem {
  return { key, label, tier, done, hint, editUrl: EDIT }
}
