import type { ModuleId, ModuleOutcome, RunReport } from '../types'

/** Fixed display order so the report reads the same way the run executes. */
const MODULE_ORDER: ModuleId[] = ['engagement', 'smart_connect', 'content', 'profile_views']

/**
 * Build a run report's module rows from each module's recorded outcome. Every module
 * the run TOUCHED (including ones that executed 0 — disabled, no_keywords, empty_search,
 * not_publish_day, …) gets a row WITH its reason, so a do-nothing run is never silent.
 * Modules with no recorded outcome (never reached) are omitted.
 */
export function buildReportModules(
  outcomes: Partial<Record<ModuleId, ModuleOutcome>>
): RunReport['modules'] {
  const rows: RunReport['modules'] = []
  for (const id of MODULE_ORDER) {
    const o = outcomes[id]
    if (!o) continue
    rows.push({ id, executed: o.executed, skipped: 0, failed: 0, reason: o.reason, withdrawn: o.withdrawn })
  }
  return rows
}
