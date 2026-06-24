import type { KeyValueStore } from '../ports'
import type { ExpertiseProfile, ModuleState, TargetProfile } from '../types'
import type { EngagementConfig } from './EngagementOrchestrator'

export const SETTINGS_KEY = 'engagement:settings'
// Owned by the side panel's useModules — the single source of truth for
// per-module automationLevel. Keep this key in sync with that composable.
const MODULES_STATE_KEY = 'modules:state'

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
  const base = (await store.get<EngagementSettings>(SETTINGS_KEY)) ?? DEFAULT_SETTINGS
  // automationLevel is owned by the module roster (SSOT) — the UI selector there
  // must actually drive the gate, so derive config.level from it.
  // chrome.storage is untyped at runtime — tolerate missing/legacy/garbage data.
  const modules = await store.get<ModuleState[]>(MODULES_STATE_KEY)
  const engagement = Array.isArray(modules)
    ? modules.find((m) => m?.id === 'engagement')
    : undefined
  if (!engagement) return base
  return { ...base, config: { ...base.config, level: engagement.automationLevel } }
}

export async function saveSettings(store: KeyValueStore, settings: EngagementSettings): Promise<void> {
  await store.set(SETTINGS_KEY, settings)
}

/** Split a comma-separated input into trimmed, non-empty tokens. */
export function parseCsv(input: string): string[] {
  return input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
}

export interface TargetForm {
  stack: string
  roles: string
  threshold: number
}

/** Apply the target form to settings (stack/roles/threshold), preserving the rest. */
export function applyTargetForm(current: EngagementSettings, form: TargetForm): EngagementSettings {
  return {
    ...current,
    target: {
      ...current.target,
      stack: parseCsv(form.stack),
      targetRoles: parseCsv(form.roles)
    },
    relevanceThreshold: Math.min(1, Math.max(0, form.threshold))
  }
}
