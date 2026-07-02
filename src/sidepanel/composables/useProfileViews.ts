import { ref, onMounted, onUnmounted } from 'vue'
import type { ProfileViewsSnapshot } from '@lib/types'
import { ProfileViewsRepository } from '@lib/storage/ProfileViewsRepository'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { upsertDailySnapshot } from '@lib/history/dailyHistory'
import { panelBus } from '../lib/panelBus'
import { DEMO_PROFILE_VIEWS, DEMO_PROFILE_VIEWS_HISTORY } from '../lib/demo'

/**
 * Owns the incoming profile-views (WVMP) lifecycle for the panel: load persisted
 * latest + history, listen for fresh SW refreshes, keep the trend live. Mirror of
 * useSsi. Outside the extension (no chrome), it degrades to demo data.
 */
export function useProfileViews() {
  const latest = ref<ProfileViewsSnapshot>(DEMO_PROFILE_VIEWS)
  const history = ref<ProfileViewsSnapshot[]>(DEMO_PROFILE_VIEWS_HISTORY)
  const isReal = ref(false)

  const repo = new ProfileViewsRepository(new ChromeStorageStore())
  let unsub = () => {}

  const apply = (snap: ProfileViewsSnapshot) => {
    latest.value = snap
    // Keep history in sync with fresh refreshes (day-bucketed, latest wins) so the
    // trend updates live without a reload.
    history.value = upsertDailySnapshot(isReal.value ? history.value : [], snap)
    isReal.value = true
  }

  onMounted(async () => {
    if (panelBus.available()) {
      const [last, hist] = await Promise.all([
        repo.latest().catch(() => null),
        repo.history().catch(() => [])
      ])
      // Mark real BEFORE apply so the freshly-loaded persisted history is merged
      // into, not discarded (apply folds into [] while isReal is still false).
      if (hist.length) {
        history.value = hist
        isReal.value = true
      }
      if (last) apply(last)
      // The panel's REQUEST_REFRESH (also sent by useSsi) triggers BOTH daily
      // metrics in the SW; policy-gated + single-flight, so a second send is a no-op.
      panelBus.send({ type: 'REQUEST_REFRESH' })
    }
    unsub = panelBus.onMessage((msg) => {
      if (msg.type === 'PROFILE_VIEWS_SNAPSHOT') apply(msg.payload)
    })
  })

  onUnmounted(() => unsub())

  return { latest, history, isReal }
}
