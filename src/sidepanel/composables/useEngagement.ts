import { ref, onMounted, onUnmounted } from 'vue'
import type { ActionQueueItem } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/**
 * Side-panel view of the quarantine queue: list pending gated actions and cancel
 * within the window. (The one-shot campaign trigger was removed — automation runs
 * via the autopilot from the Dash; the quarantine surface stays for gated comments.)
 */
export function useEngagement() {
  const quarantined = ref<ActionQueueItem[]>([])

  const loadQuarantine = async () => {
    const items = await panelBus.request<ActionQueueItem[]>({ type: 'LIST_QUARANTINE' })
    quarantined.value = (items ?? []).filter((i) => i.status === 'quarantined')
  }

  const cancel = async (id: string) => {
    await panelBus.request({ type: 'CANCEL_QUARANTINE', id })
    await loadQuarantine()
  }

  let off = () => {}
  onMounted(() => {
    void loadQuarantine()
    off = panelBus.onMessage(() => {})
  })
  onUnmounted(() => off())

  return { quarantined, cancel, loadQuarantine }
}
