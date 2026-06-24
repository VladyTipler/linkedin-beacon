import type { KeyValueStore } from '../ports'
import type { Draft } from '../types'
import { asArray } from '../engagement/settings'

/** Storage key for the generated-post draft queue. */
export const DRAFTS_KEY = 'content:drafts'

/**
 * Persisted queue of generated post drafts (design-spec §4.3). SRP: storage only —
 * generation lives in DraftGenerator. Reads guard the chrome.storage array-as-object
 * gotcha via asArray.
 */
export class DraftStore {
  constructor(private readonly store: KeyValueStore) {}

  async all(): Promise<Draft[]> {
    return asArray<Draft>(await this.store.get<Draft[]>(DRAFTS_KEY))
  }

  async add(draft: Draft): Promise<void> {
    const current = await this.all()
    current.unshift(draft) // newest first
    await this.store.set(DRAFTS_KEY, current)
  }

  async remove(id: string): Promise<void> {
    const next = (await this.all()).filter((d) => d.id !== id)
    await this.store.set(DRAFTS_KEY, next)
  }

  async update(id: string, text: string): Promise<void> {
    const next = (await this.all()).map((d) => (d.id === id ? { ...d, text } : d))
    await this.store.set(DRAFTS_KEY, next)
  }

  async clear(): Promise<void> {
    await this.store.set(DRAFTS_KEY, [])
  }
}
