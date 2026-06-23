import type { SsiPillarKey, SsiSnapshot } from '@lib/types'

export interface PillarView {
  key: SsiPillarKey
  label: string
  /** "19/25" */
  score: string
  /** 0..100 width percentage of the 0..25 score. */
  pct: number
  /** CSS gradient for the fill bar (matches design-reference per pillar). */
  gradient: string
}

const GRADIENT: Record<SsiPillarKey, string> = {
  brand: 'linear-gradient(90deg,#c4ff4d,#8fbb2e)',
  people: 'linear-gradient(90deg,#4d9fff,#3a7fd0)',
  insights: 'linear-gradient(90deg,#3ddc8a,#2bb06f)',
  relationships: 'linear-gradient(90deg,#ff8a5c,#e0683c)'
}

/** Map a snapshot's pillars to render-ready view models. Pure. */
export function pillarsToView(snapshot: SsiSnapshot): PillarView[] {
  return snapshot.pillars.map((p) => ({
    key: p.key,
    label: p.label,
    score: `${round(p.score)}/25`,
    pct: clampPct((p.score / 25) * 100),
    gradient: GRADIENT[p.key]
  }))
}

function round(n: number): number {
  return Math.round(n)
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}
