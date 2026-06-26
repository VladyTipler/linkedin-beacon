import type { KeyValueStore } from '../ports'
import type { ExpertiseProfile } from '../types'

export const CONNECT_SETTINGS_KEY = 'connect:settings'

/** Default to the US market (Vlad targets USD-remote); editable in the module card. */
export const DEFAULT_TARGET_REGIONS = ['US']

/** The user's "who to search" keywords + which global regions to target for Smart Connect. */
export interface ConnectSettings {
  searchKeywords: string
  targetRegions: string[]
}

/** Prefill: first stack term + "recruiter" (recruiters + peers), else just "recruiter". */
export function defaultConnectKeywords(expertise: ExpertiseProfile): string {
  const stack = expertise.stack?.[0]?.trim()
  return stack ? `${stack} recruiter` : 'recruiter'
}

export async function loadConnectSettings(store: KeyValueStore): Promise<ConnectSettings> {
  const raw = await store.get<ConnectSettings>(CONNECT_SETTINGS_KEY)
  return {
    searchKeywords: typeof raw?.searchKeywords === 'string' ? raw.searchKeywords : '',
    targetRegions: Array.isArray(raw?.targetRegions) ? raw.targetRegions : DEFAULT_TARGET_REGIONS
  }
}

export async function saveConnectSettings(store: KeyValueStore, s: ConnectSettings): Promise<void> {
  await store.set(CONNECT_SETTINGS_KEY, s)
}
