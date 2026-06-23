// Narrow ports (ISP + DIP). Core depends on these abstractions;
// concrete adapters that touch document/chrome/Date implement them at the edges.

import type { SsiSnapshot } from './types'

/** Time source — injected so tests are deterministic (no real Date.now in core). */
export interface Clock {
  now(): Date
}

/** A place that can yield the current SSI page DOM for parsing. */
export interface SsiSource {
  /** The DOM root to parse (e.g. document on the /sales/ssi tab). */
  getRoot(): ParentNode | null
}

/** Minimal async key/value persistence (subset of chrome.storage). */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
}

/**
 * A single way to extract an SSI snapshot from a DOM root.
 * Strategies are tried in order; the first non-null wins (OCP — add, don't edit).
 */
export interface SsiParseStrategy {
  readonly name: string
  /** Returns a snapshot, or null if this strategy cannot read the given root. */
  parse(root: ParentNode): Omit<SsiSnapshot, 'capturedAt'> | null
}

/**
 * Opens and disposes a short-lived background tab on /sales/ssi so SSI can be
 * refreshed from any page (or with no LinkedIn tab open). Edge abstraction over
 * chrome.windows/tabs — injected so the refresh orchestrator stays testable.
 */
export interface TabController {
  /** Open the SSI page in a background worker tab; resolves with its tab id. */
  openSsiTab(): Promise<number>
  /** Tear down the worker tab/window previously opened. */
  close(tabId: number): Promise<void>
}
