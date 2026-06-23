import type { KeyValueStore } from '../ports'
import type { ExpertiseProfile, TargetProfile } from '../types'
import type { EngagementConfig } from './EngagementOrchestrator'

export const SETTINGS_KEY = 'engagement:settings'

export interface EngagementSettings {
  config: EngagementConfig
  target: TargetProfile
  expertise: ExpertiseProfile
  /** Minimum RelevanceScorer score (0..1) for a post to be worth engaging. */
  relevanceThreshold: number
}

/** Safe defaults: manual approval, conservative budgets (design-spec §5.2). */
export const DEFAULT_SETTINGS: EngagementSettings = {
  config: {
    level: 'manual',
    guardrails: {
      minConfidence: 0.6,
      bannedPhrases: ['great post', 'thanks for sharing', 'well said'],
      quarantineMinutes: 10,
      lenRange: [12, 280]
    },
    dailyLimits: { like: 60, comment: 10, connect: 0, post: 0 }
  },
  target: { stack: [], targetRoles: ['recruiter', 'talent', 'hiring'], geos: [], watchlistCompanies: [] },
  expertise: { headline: '', stack: [] },
  relevanceThreshold: 0.3
}

export async function loadSettings(store: KeyValueStore): Promise<EngagementSettings> {
  return (await store.get<EngagementSettings>(SETTINGS_KEY)) ?? DEFAULT_SETTINGS
}

export async function saveSettings(store: KeyValueStore, settings: EngagementSettings): Promise<void> {
  await store.set(SETTINGS_KEY, settings)
}
