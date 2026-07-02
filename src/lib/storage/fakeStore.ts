import type { KeyValueStore } from '../ports'

/**
 * Shared in-memory KeyValueStore test double. One definition for every repo/refresh
 * test, so adding a method to the port is a single edit (not four divergent copies).
 * `data` is public so tests can assert on the raw persisted shape/keys.
 */
export class FakeStore implements KeyValueStore {
  data = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }
}
