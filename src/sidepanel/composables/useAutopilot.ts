import { ref, onMounted, onUnmounted } from 'vue'
import type { AutopilotHost, AutopilotStatus, RunReport } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/**
 * Side-panel view of the autopilot: start/stop, live status, run reports. SRP:
 * panel ↔ SW messaging only; all decisions live in the SW gatekeeper.
 */
export function useAutopilot() {
  const status = ref<AutopilotStatus | null>(null)
  const reports = ref<RunReport[]>([])

  const loadReports = async () => {
    reports.value = (await panelBus.request<RunReport[]>({ type: 'LIST_REPORTS' })) ?? []
  }
  const start = (host: AutopilotHost) => panelBus.send({ type: 'START_AUTOPILOT', host })
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

  return { status, reports, start, stop, loadReports }
}
