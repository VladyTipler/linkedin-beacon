import type { KeyValueStore } from '../ports'
import type { ExpertiseProfile } from '../types'
import { asArray, loadSettings } from '../engagement/settings'

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
  // chrome.storage serialises a saved reactive array as an array-like object {0:..,1:..};
  // asArray recovers it (and an already-corrupted store) so regions aren't silently dropped.
  const regions = asArray<string>(raw?.targetRegions)
  return {
    searchKeywords: typeof raw?.searchKeywords === 'string' ? raw.searchKeywords : '',
    targetRegions: regions.length ? regions : DEFAULT_TARGET_REGIONS
  }
}

export async function saveConnectSettings(store: KeyValueStore, s: ConnectSettings): Promise<void> {
  await store.set(CONNECT_SETTINGS_KEY, s)
}

/**
 * Return the Modules card's search keywords AND make sure they are persisted: the saved value if
 * the user has one, otherwise the expertise-derived prefill — which we PERSIST so the field never
 * displays a value a run won't use. Fixes the silent mismatch where the card showed a prefill that
 * was never saved while a run read empty storage and no-op'd (`no_keywords`). The run still reads
 * persisted storage only (safe no-op + "не задан поиск" when the card was never opened) — so a run
 * only ever acts on keywords the user has actually seen in the card. Regions are preserved.
 */
export async function ensureSearchKeywords(store: KeyValueStore): Promise<string> {
  const settings = await loadConnectSettings(store)
  if (settings.searchKeywords.trim()) return settings.searchKeywords
  const { expertise } = await loadSettings(store)
  const searchKeywords = defaultConnectKeywords(expertise)
  await saveConnectSettings(store, { ...settings, searchKeywords })
  return searchKeywords
}
