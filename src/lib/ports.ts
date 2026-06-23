// Narrow ports (ISP + DIP). Core depends on these abstractions;
// concrete adapters that touch document/chrome/Date implement them at the edges.

import type { SsiSnapshot } from './types'

/** Time source — injected so tests are deterministic (no real Date.now in core). */
export interface Clock {
  now(): Date
}

/**
 * Randomness source — injected so jitter, human delays and budget noise are
 * deterministic in tests (the anti-ban analogue of Clock). Real impl wraps
 * Math.random in a thin adapter; tests pass a fixed value.
 */
export interface Rng {
  /** Uniform float in [0, 1]. */
  next(): number
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
 * One-shot timer scheduling (subset of chrome.alarms). Injected so the
 * quarantine queue is testable without chrome and survives SW eviction (the
 * alarm, not an in-memory timer, is what wakes the worker).
 */
export interface AlarmScheduler {
  /** Schedule a one-shot alarm to fire at the given epoch ms. */
  schedule(name: string, whenMs: number): void
  clear(name: string): void
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
