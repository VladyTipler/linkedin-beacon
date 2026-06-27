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
  /** The run's current step label ("Добавляю в сеть…") — broadcast by the SW as it moves. */
  const stage = ref<string | null>(null)

  const loadReports = async () => {
    reports.value = (await panelBus.request<RunReport[]>({ type: 'LIST_REPORTS' })) ?? []
  }
  // The SW gates the launch on enabled modules; surface its "no enabled modules"
  // verdict instead of pre-deciding here (the SW is the source of truth).
  // Always launch in the current tab now (the worker-window option was removed — the user
  // prepares their own window/monitor). `host` defaults to 'tab'.
  const start = async (host: AutopilotHost = 'tab') => {
    startHint.value = null
    const res = await panelBus.request<StartAutopilotResult>({ type: 'START_AUTOPILOT', host })
    if (res && !res.started && res.reason === 'no-modules') {
      startHint.value = 'Нет включённых модулей — включи хотя бы один в «Модулях».'
    }
  }
  const stop = async () => {
    // The MV3 SW can be evicted on idle when the user clicks Stop — a fire-and-forget
    // sendMessage is then silently lost (the run keeps going). Warm it with a PING first
    // (the crxjs loader imports the SW entry async), then await STOP's sendResponse and
    // retry a couple of times if the SW was cold. Confirms the stop actually landed.
    await panelBus.request({ type: 'PING' })
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await panelBus.request<{ ok?: boolean }>({ type: 'STOP_AUTOPILOT' })
      if (res?.ok) return
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  let off = () => {}
  onMounted(() => {
    void loadReports()
    off = panelBus.onMessage((m) => {
      if (m.type === 'AUTOPILOT_STATUS') {
        status.value = m.status
        if (!m.status.running) stage.value = null // run ended — drop the stale step label
      }
      if (m.type === 'AUTOPILOT_STAGE') stage.value = m.label
      if (m.type === 'AUTOPILOT_REPORT') void loadReports()
    })
  })
  onUnmounted(() => off())

  return { status, stage, reports, startHint, start, stop, loadReports }
}
