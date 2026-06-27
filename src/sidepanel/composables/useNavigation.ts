import { ref } from 'vue'

export type ViewId = 'v-dash' | 'v-auto' | 'v-inbox' | 'v-set' | 'v-reports' | 'v-content' | 'v-settings' | 'v-profile'

export interface NavItem {
  id: ViewId
  label: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'v-dash', label: 'SSI' },
  { id: 'v-auto', label: 'Модули' },
  { id: 'v-reports', label: 'Отчёты' },
  { id: 'v-content', label: 'Контент' }
]

/** Active-view state for the bottom nav. SRP: navigation only. */
export function useNavigation(initial: ViewId = 'v-dash') {
  const active = ref<ViewId>(initial)
  const go = (id: ViewId) => {
    active.value = id
  }
  return { active, go, items: NAV_ITEMS }
}
