import { ref } from 'vue'
import { auditProfile } from '@lib/profile/auditProfile'
import type { ProfileAudit, ProfileSnapshot } from '@lib/profile/contracts'

const DEMO: ProfileSnapshot = {
  hasPhoto: true,
  hasBanner: false,
  headline: 'Frontend TechLead',
  about: 'Демо-профиль.',
  location: 'Chisinau',
  industry: 'Software',
  educationCount: 1,
  pastPositionCount: 1,
  skillCount: 6,
  recommendationCount: 1,
  hasCurrentPosition: true,
  hasFeatured: false,
  hasCustomUrl: true,
}

export function useProfileAudit() {
  const audit = ref<ProfileAudit | null>(null)
  const loading = ref(false)

  const refresh = async () => {
    loading.value = true
    // Task 11 replaces this DEMO with a real REQUEST_PROFILE_AUDIT round-trip.
    const snap = DEMO
    audit.value = auditProfile(snap)
    loading.value = false
  }

  void refresh()
  return { audit, loading, refresh }
}
