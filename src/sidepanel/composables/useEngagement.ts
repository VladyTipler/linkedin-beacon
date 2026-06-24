import { ref, onMounted, onUnmounted } from 'vue'
import type { ActionQueueItem, EngagementRunSummary } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/**
 * Side-panel view of the engagement engine: trigger a run, watch its summary,
 * and manage the quarantine queue (list + cancel within the window). SRP: panel
 * ↔ SW messaging for engagement; all logic lives in the SW orchestrator.
 */
export function useEngagement() {
  const summary = ref<EngagementRunSummary | null>(null)
  const quarantined = ref<ActionQueueItem[]>([])

  const loadQuarantine = async () => {
    const items = await panelBus.request<ActionQueueItem[]>({ type: 'LIST_QUARANTINE' })
    quarantined.value = (items ?? []).filter((i) => i.status === 'quarantined')
  }

  const runCampaign = async () => {
    const result = await panelBus.request<EngagementRunSummary>({ type: 'RUN_ENGAGEMENT' })
    if (result) summary.value = result
    await loadQuarantine()
  }

  const cancel = async (id: string) => {
    await panelBus.request({ type: 'CANCEL_QUARANTINE', id })
    await loadQuarantine()
  }

  let off = () => {}
  onMounted(() => {
    void loadQuarantine()
    off = panelBus.onMessage((message) => {
      if (message.type === 'ENGAGEMENT_RESULT') {
        summary.value = message.summary
        void loadQuarantine()
      }
    })
  })
  onUnmounted(() => off())

  return { summary, quarantined, runCampaign, cancel, loadQuarantine }
}
