import { ref, onMounted } from 'vue'
import type { ModuleId, ModuleState } from '@lib/types'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { asArray } from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

const STORE_KEY = 'modules:state'

/** Default module roster. Only engagement acts today; the rest are "coming soon". */
export function defaultModules(): ModuleState[] {
  return [
    { id: 'engagement', enabled: true, automationLevel: 'manual', available: true, dailyLimit: 35 },
    { id: 'smart_connect', enabled: false, automationLevel: 'manual', available: true, dailyLimit: 100 },
    { id: 'content', enabled: false, automationLevel: 'manual', available: true, dailyLimit: 10 },
    { id: 'profile_views', enabled: false, automationLevel: 'manual', available: true, dailyLimit: 40 }
  ]
}

/** Owns module enable + per-module daily limit with persistence. SRP: module config. */
export function useModules() {
  const modules = ref<ModuleState[]>(defaultModules())
  const store = new ChromeStorageStore()

  const persist = () => {
    // Persist a PLAIN array, not the Vue reactive proxy — chrome.storage serialises
    // a reactive array as an array-like object {0:..,1:..}, which reads back non-array.
    if (panelBus.available()) void store.set(STORE_KEY, modules.value.map((m) => ({ ...m })))
  }

  onMounted(async () => {
    if (!panelBus.available()) return
    const saved = asArray<ModuleState>(await store.get<ModuleState[]>(STORE_KEY).catch(() => null))
    if (saved.length) modules.value = mergeWithDefaults(saved)
  })

  const find = (id: ModuleId) => modules.value.find((m) => m.id === id)

  const toggle = (id: ModuleId) => {
    const m = find(id)
    if (!m || !m.available) return
    m.enabled = !m.enabled
    persist()
  }

  const setLimit = (id: ModuleId, n: number) => {
    const m = find(id)
    if (!m) return
    m.dailyLimit = Math.max(0, Math.round(n))
    persist()
  }

  return { modules, toggle, setLimit }
}

/** Keep new default modules if storage predates them; backfill a missing dailyLimit. Pin availability from current build. */
function mergeWithDefaults(saved: ModuleState[]): ModuleState[] {
  return defaultModules().map((def) => {
    const s = saved.find((x) => x.id === def.id)
    return s
      ? {
          ...def,
          ...s,
          available: def.available,
          dailyLimit: typeof s.dailyLimit === 'number' ? s.dailyLimit : def.dailyLimit
        }
      : def
  })
}
