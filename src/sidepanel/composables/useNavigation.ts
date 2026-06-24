import { ref } from 'vue'

export type ViewId = 'v-dash' | 'v-auto' | 'v-inbox' | 'v-set' | 'v-reports' | 'v-content' | 'v-settings'

export interface NavItem {
  id: ViewId
  label: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'v-dash', label: 'SSI' },
  { id: 'v-auto', label: 'Модули' },
  { id: 'v-inbox', label: 'Входящие' },
  { id: 'v-set', label: 'Защита' },
  { id: 'v-reports', label: 'Отчёты' }
]

/** Active-view state for the bottom nav. SRP: navigation only. */
export function useNavigation(initial: ViewId = 'v-dash') {
  const active = ref<ViewId>(initial)
  const go = (id: ViewId) => {
    active.value = id
  }
  return { active, go, items: NAV_ITEMS }
}
