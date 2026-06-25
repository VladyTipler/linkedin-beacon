import type { ModuleState } from '../types'
import { asArray } from '../engagement/settings'

/** Default likes/day when the engagement module has no configured limit. */
export const DEFAULT_LIKES_PER_DAY = 35

/**
 * The configured likes/day for the engagement module — the BASE for the autopilot
 * daily ceiling (DailyCeiling then applies ± jitter + warmup). Reads from the
 * persisted modules:state roster; guards the chrome.storage array-as-object gotcha.
 */
export function engagementLimit(modulesState: unknown): number {
  const m = asArray<ModuleState>(modulesState).find((x) => x?.id === 'engagement')
  const n = m?.dailyLimit
  return typeof n === 'number' && n > 0 ? n : DEFAULT_LIKES_PER_DAY
}
