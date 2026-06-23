import type { SsiSnapshot } from '../../types'
import type { SsiParseStrategy } from '../../ports'
import { PILLARS } from '../pillars'
import { parseScore, clampPillar, normaliseRank, sumPillars } from '../parse-helpers'

/**
 * Primary strategy: read structured elements on /sales/ssi.
 *
 * Contract with the page (confirm against a live capture before shipping):
 *  - total:      [data-beacon-ssi="total"]   (fallback: .ssi-total-score)
 *  - pillar:     [data-beacon-pillar="<key>"] containing the numeric score
 *  - ranks:      [data-beacon-rank="industry"|"network"]
 *
 * We intentionally support a `data-beacon-*` overlay so the content script can
 * tag nodes it recognises, keeping brittle LinkedIn class names in ONE place
 * (this strategy) rather than scattered across the codebase (SRP).
 */
export class DomSelectorStrategy implements SsiParseStrategy {
  readonly name = 'dom-selector'

  parse(root: ParentNode): Omit<SsiSnapshot, 'capturedAt'> | null {
    const pillars = PILLARS.map((def) => {
      const el =
        root.querySelector(`[data-beacon-pillar="${def.key}"]`) ??
        root.querySelector(`.ssi-pillar-${def.key}`)
      const score = clampPillar(parseScore(el?.textContent) ?? Number.NaN)
      return { key: def.key, label: def.label, score, found: el != null }
    })

    // If we couldn't locate any pillar node, this strategy doesn't apply.
    if (!pillars.some((p) => p.found)) return null

    const totalEl =
      root.querySelector('[data-beacon-ssi="total"]') ??
      root.querySelector('.ssi-total-score')
    const parsedTotal = parseScore(totalEl?.textContent)
    const total = parsedTotal ?? sumPillars(pillars.map((p) => p.score))

    const industryRank = normaliseRank(
      root.querySelector('[data-beacon-rank="industry"]')?.textContent
    )
    const networkRank = normaliseRank(
      root.querySelector('[data-beacon-rank="network"]')?.textContent
    )

    return {
      total,
      pillars: pillars.map(({ key, label, score }) => ({ key, label, score })),
      ...(industryRank ? { industryRank } : {}),
      ...(networkRank ? { networkRank } : {})
    }
  }
}
