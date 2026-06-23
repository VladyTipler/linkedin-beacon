import type { SsiPillarKey } from '../types'

/**
 * Canonical pillar order + bilingual matchers. LinkedIn renders these four,
 * always summing to 100. Order here is the canonical display order.
 */
export interface PillarDef {
  key: SsiPillarKey
  label: string
  /**
   * Stable `id` of the LinkedIn <progress> bar on /sales/ssi. These ids are
   * semantic and language-independent (verified against a live capture 2026-06),
   * and the element exposes an exact numeric `value` attribute — preferred over
   * scraping text. This is the single brittle coupling to LinkedIn's markup.
   */
  domId: string
  /** Lowercased substrings that identify this pillar in page text (EN + RU). */
  matchers: string[]
}

export const PILLARS: readonly PillarDef[] = [
  {
    key: 'brand',
    label: 'Профессиональный бренд',
    domId: 'establish-brand__sub-score-bar',
    matchers: ['establish your professional brand', 'professional brand', 'бренд']
  },
  {
    key: 'people',
    label: 'Нужные люди',
    domId: 'find-people__sub-score-bar',
    matchers: ['find the right people', 'right people', 'люди']
  },
  {
    key: 'insights',
    label: 'Инсайты',
    domId: 'engage-with-insights__sub-score-bar',
    matchers: ['engage with insights', 'insights', 'инсайт']
  },
  {
    key: 'relationships',
    label: 'Отношения',
    domId: 'build-relationships__sub-score-bar',
    matchers: ['build relationships', 'relationships', 'отношен', 'связи']
  }
]

/** Lowercased substrings that classify the two SSI rank rows (EN + RU). */
export const RANK_MATCHERS = {
  industry: ['industry', 'отрасл'],
  network: ['network', 'сет']
} as const

export const PILLAR_KEYS: readonly SsiPillarKey[] = PILLARS.map((p) => p.key)
