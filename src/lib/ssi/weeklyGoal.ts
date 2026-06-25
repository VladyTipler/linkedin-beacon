import type { ModuleId, SsiPillar, SsiPillarKey } from '../types'

export interface WeeklyGoal {
  pillarKey: SsiPillarKey
  pillarLabel: string
  /** Current pillar score (0..25). */
  score: number
  /** A reachable next milestone (score + 3, capped at 25). */
  target: number
  /** The lever module that raises this pillar. */
  module: ModuleId
  /** One-line human-readable suggestion. */
  message: string
}

/** Which Beacon module raises each SSI pillar (the lever map). */
const PILLAR_LEVER: Record<SsiPillarKey, { module: ModuleId; how: string }> = {
  insights: { module: 'engagement', how: 'усилит вовлечённость — умные лайки и комментарии в ленте' },
  brand: { module: 'content', how: 'поднимет бренд — посты из идей твоей ленты' },
  people: { module: 'smart_connect', how: 'найдёт нужных людей — коннекты рекрутёрам и ЦА' },
  relationships: { module: 'smart_connect', how: 'построит связи — коннекты с персональным Note' }
}

/**
 * The week's focus: the WEAKEST SSI pillar + the module that raises it. Pure,
 * deterministic — no LLM needed (the pillar→lever mapping is fixed). Operationalises
 * the north-star: lift each pillar by pointing the user at the right lever.
 */
export function weeklyGoal(pillars: SsiPillar[]): WeeklyGoal | null {
  if (!pillars.length) return null
  const weakest = pillars.reduce((min, p) => (p.score < min.score ? p : min))
  const lever = PILLAR_LEVER[weakest.key]
  const target = Math.min(25, weakest.score + 3)
  return {
    pillarKey: weakest.key,
    pillarLabel: weakest.label,
    score: weakest.score,
    target,
    module: lever.module,
    message: `Слабее всего «${weakest.label}» (${weakest.score}/25). Beacon ${lever.how}.`
  }
}
