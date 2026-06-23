import type { SsiSnapshot } from '../types'
import type { KeyValueStore } from '../ports'

const LATEST_KEY = 'ssi:latest'
const HISTORY_KEY = 'ssi:history'

/**
 * Persists SSI snapshots. SRP: only storage concerns — knows nothing about DOM
 * or parsing. DIP: depends on the KeyValueStore port, so it's testable with a
 * fake and swappable to chrome.storage in production.
 */
export class SsiRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly historyLimit = 30
  ) {}

  async save(snapshot: SsiSnapshot): Promise<void> {
    await this.store.set(LATEST_KEY, snapshot)
    const history = (await this.store.get<SsiSnapshot[]>(HISTORY_KEY)) ?? []
    const next = [...history, snapshot].slice(-this.historyLimit)
    await this.store.set(HISTORY_KEY, next)
  }

  async latest(): Promise<SsiSnapshot | null> {
    return this.store.get<SsiSnapshot>(LATEST_KEY)
  }

  async history(): Promise<SsiSnapshot[]> {
    return (await this.store.get<SsiSnapshot[]>(HISTORY_KEY)) ?? []
  }
}
