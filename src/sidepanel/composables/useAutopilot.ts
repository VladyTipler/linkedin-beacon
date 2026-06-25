import { ref, onMounted, onUnmounted } from 'vue'
import type { AutopilotHost, AutopilotStatus, RunReport, StartAutopilotResult } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/**
 * Side-panel view of the autopilot: start/stop, live status, run reports. SRP:
 * panel ↔ SW messaging only; all decisions live in the SW gatekeeper.
 */
export function useAutopilot() {
  const status = ref<AutopilotStatus | null>(null)
  const reports = ref<RunReport[]>([])
  const startHint = ref<string | null>(null)

  const loadReports = async () => {
    reports.value = (await panelBus.request<RunReport[]>({ type: 'LIST_REPORTS' })) ?? []
  }
  // The SW gates the launch on enabled modules; surface its "no enabled modules"
  // verdict instead of pre-deciding here (the SW is the source of truth).
  const start = async (host: AutopilotHost) => {
    startHint.value = null
    const res = await panelBus.request<StartAutopilotResult>({ type: 'START_AUTOPILOT', host })
    if (res && !res.started && res.reason === 'no-modules') {
      startHint.value = 'Нет включённых модулей — включи хотя бы один в «Модулях».'
    }
  }
  const stop = () => panelBus.send({ type: 'STOP_AUTOPILOT' })

  let off = () => {}
  onMounted(() => {
    void loadReports()
    off = panelBus.onMessage((m) => {
      if (m.type === 'AUTOPILOT_STATUS') status.value = m.status
      if (m.type === 'AUTOPILOT_REPORT') void loadReports()
    })
  })
  onUnmounted(() => off())

  return { status, reports, startHint, start, stop, loadReports }
}
