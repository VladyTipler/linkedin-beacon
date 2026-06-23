import type { SsiSnapshot } from '../../types'
import type { SsiParseStrategy } from '../../ports'
import { PILLARS } from '../pillars'
import { clampPillar, parseScore, sumPillars } from '../parse-helpers'

/**
 * Resilient fallback: walk visible text lines and pair each pillar label with
 * the nearest number. Survives LinkedIn class-name churn at the cost of
 * precision. Used only when DomSelectorStrategy fails (LSP: same contract).
 */
export class TextScanStrategy implements SsiParseStrategy {
  readonly name = 'text-scan'

  parse(root: ParentNode): Omit<SsiSnapshot, 'capturedAt'> | null {
    const text = (root.textContent ?? '').toLowerCase()
    if (!text.includes('social selling')) return null

    const pillars = PILLARS.map((def) => {
      const score = this.findScoreNear(text, def.matchers)
      return {
        key: def.key,
        label: def.label,
        score: clampPillar(score ?? Number.NaN),
        found: score != null
      }
    })

    if (!pillars.some((p) => p.found)) return null

    return {
      total: sumPillars(pillars.map((p) => p.score)),
      pillars: pillars.map(({ key, label, score }) => ({ key, label, score }))
    }
  }

  /** Find the first number appearing within 40 chars after any matcher. */
  private findScoreNear(haystack: string, matchers: string[]): number | null {
    for (const matcher of matchers) {
      const idx = haystack.indexOf(matcher)
      if (idx === -1) continue
      const window = haystack.slice(idx, idx + matcher.length + 40)
      const score = parseScore(window.slice(matcher.length))
      if (score != null) return score
    }
    return null
  }
}
