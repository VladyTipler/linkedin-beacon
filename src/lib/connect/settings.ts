import type { KeyValueStore } from '../ports'
import type { ExpertiseProfile } from '../types'

export const CONNECT_SETTINGS_KEY = 'connect:settings'

/** The user's "who to search" keywords for Smart Connect. */
export interface ConnectSettings {
  searchKeywords: string
}

/** Prefill: first stack term + "recruiter" (recruiters + peers), else just "recruiter". */
export function defaultConnectKeywords(expertise: ExpertiseProfile): string {
  const stack = expertise.stack?.[0]?.trim()
  return stack ? `${stack} recruiter` : 'recruiter'
}

export async function loadConnectSettings(store: KeyValueStore): Promise<ConnectSettings> {
  const raw = await store.get<ConnectSettings>(CONNECT_SETTINGS_KEY)
  return { searchKeywords: typeof raw?.searchKeywords === 'string' ? raw.searchKeywords : '' }
}

export async function saveConnectSettings(store: KeyValueStore, s: ConnectSettings): Promise<void> {
  await store.set(CONNECT_SETTINGS_KEY, s)
}
