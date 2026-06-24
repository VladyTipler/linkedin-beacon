import { ref, onMounted } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  applyTargetForm,
  type EngagementSettings
} from '@lib/engagement/settings'
import { panelBus } from '../lib/panelBus'

/**
 * Target-profile settings for the engagement module (stack / roles / threshold),
 * persisted to `engagement:settings` — the same key the SW reads. Replaces the
 * console workaround. SRP: form state ↔ storage; the merge logic is the tested
 * pure `applyTargetForm`. automationLevel is NOT here — it stays in the module
 * selector (modules:state) as the SSOT.
 */
export function useEngagementSettings() {
  const store = new ChromeStorageStore()
  const stack = ref('')
  const roles = ref('')
  const threshold = ref(0.3)
  const saved = ref(false)
  let current: EngagementSettings = DEFAULT_SETTINGS

  onMounted(async () => {
    if (!panelBus.available()) return
    const loaded = await store.get<EngagementSettings>(SETTINGS_KEY).catch(() => null)
    current = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) }
    const target = current.target ?? DEFAULT_SETTINGS.target
    stack.value = (Array.isArray(target.stack) ? target.stack : []).join(', ')
    roles.value = (Array.isArray(target.targetRoles) ? target.targetRoles : []).join(', ')
    threshold.value = typeof current.relevanceThreshold === 'number' ? current.relevanceThreshold : 0.3
  })

  const save = async () => {
    current = applyTargetForm(current, {
      stack: stack.value,
      roles: roles.value,
      threshold: threshold.value
    })
    if (panelBus.available()) await store.set(SETTINGS_KEY, current)
    saved.value = true
    setTimeout(() => (saved.value = false), 1500)
  }

  return { stack, roles, threshold, saved, save }
}
