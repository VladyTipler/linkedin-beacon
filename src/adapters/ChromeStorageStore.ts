import type { KeyValueStore } from '@lib/ports'

/**
 * chrome.storage.local implementation of KeyValueStore. Thin edge adapter:
 * the only place core storage logic touches the chrome.* API (DIP boundary).
 */
export class ChromeStorageStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.local.get(key)
    return (result[key] as T) ?? null
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }
}
