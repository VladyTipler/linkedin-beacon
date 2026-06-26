/** A read of the user's own LinkedIn profile, enough to audit completeness. */
export interface ProfileSnapshot {
  hasPhoto: boolean
  hasBanner: boolean
  headline: string | null
  about: string | null
  location: string | null
  industry: string | null
  educationCount: number
  pastPositionCount: number
  skillCount: number
  recommendationCount: number
  hasCurrentPosition: boolean
  hasFeatured: boolean
  hasCustomUrl: boolean
}

export interface AuditItem {
  key: string
  label: string
  /** 'official' = LinkedIn All-Star gate (a594698); 'best-practice' = convergent, NOT a confirmed factor. */
  tier: 'official' | 'best-practice'
  done: boolean
  hint: string
  editUrl: string
}

export interface ProfileAudit {
  items: AuditItem[]
  /** 0..100, Tier-1 (official 7) only. */
  completeness: number
  isAllStar: boolean
  officialDone: number
  officialTotal: number
}
