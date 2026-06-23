import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { SsiSnapshot } from '@lib/types'
import { SsiRepository } from '@lib/storage/SsiRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { panelBus } from '../lib/panelBus'
import { pillarsToView } from '../lib/ssiView'
import { DEMO_SSI } from '../lib/demo'

/**
 * Owns the SSI snapshot lifecycle for the panel: load persisted latest,
 * listen for fresh parses, expose a refresh trigger. DIP: storage via repo.
 */
export function useSsi() {
  const snapshot = ref<SsiSnapshot>(DEMO_SSI)
  const isReal = ref(false)
  const refreshing = ref(false)

  const repo = new SsiRepository(new ChromeStorageStore())
  let unsub = () => {}

  const apply = (snap: SsiSnapshot) => {
    snapshot.value = snap
    isReal.value = true
    refreshing.value = false
  }

  onMounted(async () => {
    if (panelBus.available()) {
      const latest = await repo.latest().catch(() => null)
      if (latest) apply(latest)
    }
    unsub = panelBus.onMessage((msg) => {
      if (msg.type === 'SSI_SNAPSHOT') apply(msg.payload)
      if (msg.type === 'SSI_PARSE_FAILED') refreshing.value = false
    })
  })

  onUnmounted(() => unsub())

  const refresh = () => {
    refreshing.value = true
    panelBus.send({ type: 'REQUEST_SSI' })
  }

  const pillars = computed(() => pillarsToView(snapshot.value))
  const total = computed(() => snapshot.value.total)

  return { snapshot, pillars, total, isReal, refreshing, refresh }
}
