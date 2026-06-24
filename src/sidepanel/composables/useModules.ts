import { ref, onMounted } from 'vue'
import type { AutomationLevel, ModuleId, ModuleState } from '@lib/types'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { asArray } from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

const STORE_KEY = 'modules:state'

/** Default module roster — mirrors the demo (auto_apply is "coming soon"). */
export function defaultModules(): ModuleState[] {
  return [
    { id: 'engagement', enabled: true, automationLevel: 'manual', available: true },
    { id: 'smart_connect', enabled: true, automationLevel: 'manual', available: true },
    { id: 'content', enabled: true, automationLevel: 'manual', available: true },
    { id: 'auto_apply', enabled: false, automationLevel: 'manual', available: false }
  ]
}

/** Owns module enable/automation state with persistence. SRP: module config. */
export function useModules() {
  const modules = ref<ModuleState[]>(defaultModules())
  const store = new ChromeStorageStore()

  const persist = () => {
    // Persist a PLAIN array, not the Vue reactive proxy — chrome.storage
    // serialises a reactive array as an array-like object {0:..,1:..}, which then
    // reads back as a non-array and silently breaks the SSOT level bridge.
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

  const setLevel = (id: ModuleId, level: AutomationLevel) => {
    const m = find(id)
    if (!m || !m.available) return
    m.automationLevel = level
    persist()
  }

  return { modules, toggle, setLevel }
}

/** Keep new default modules if storage predates them (forward-compatible). */
function mergeWithDefaults(saved: ModuleState[]): ModuleState[] {
  return defaultModules().map((def) => saved.find((s) => s.id === def.id) ?? def)
}
