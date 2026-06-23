import type { SsiPillarKey } from '../types'

/**
 * Canonical pillar order + bilingual matchers. LinkedIn renders these four,
 * always summing to 100. Order here is the canonical display order.
 */
export interface PillarDef {
  key: SsiPillarKey
  label: string
  /** Lowercased substrings that identify this pillar in page text (EN + RU). */
  matchers: string[]
}

export const PILLARS: readonly PillarDef[] = [
  {
    key: 'brand',
    label: 'Профессиональный бренд',
    matchers: ['establish your professional brand', 'professional brand', 'бренд']
  },
  {
    key: 'people',
    label: 'Нужные люди',
    matchers: ['find the right people', 'right people', 'люди']
  },
  {
    key: 'insights',
    label: 'Инсайты',
    matchers: ['engage with insights', 'insights', 'инсайт']
  },
  {
    key: 'relationships',
    label: 'Отношения',
    matchers: ['build relationships', 'relationships', 'отношен', 'связи']
  }
]

export const PILLAR_KEYS: readonly SsiPillarKey[] = PILLARS.map((p) => p.key)
