import type { InboundLead, ProfileViewsSnapshot, SsiSnapshot } from '@lib/types'

/**
 * Seed/placeholder data shown before the first real parse, mirroring the
 * approved demo artifact 1:1. Replaced live the moment a real SSI_SNAPSHOT
 * arrives from the content script. NOT used once real data exists.
 */
export const DEMO_SSI: SsiSnapshot = {
  total: 82,
  pillars: [
    { key: 'brand', label: 'Профессиональный бренд', score: 19 },
    { key: 'people', label: 'Поиск нужных людей', score: 17 },
    { key: 'insights', label: 'Обмен инсайтами', score: 21 },
    { key: 'relationships', label: 'Построение связей', score: 15 }
  ],
  industryRank: 'Top 4%',
  networkRank: 'Top 1%',
  capturedAt: '2026-06-23T00:00:00.000Z'
}

/**
 * Seed SSI history so the trend widget is showcased in demo mode (no chrome.storage).
 * Replaced by real day-bucketed history the moment the extension runs. NOT real data.
 */
export const DEMO_SSI_HISTORY: SsiSnapshot[] = [
  {
    total: 68,
    pillars: [
      { key: 'brand', label: 'Профессиональный бренд', score: 15 },
      { key: 'people', label: 'Поиск нужных людей', score: 14 },
      { key: 'insights', label: 'Обмен инсайтами', score: 24 },
      { key: 'relationships', label: 'Построение связей', score: 15 }
    ],
    capturedAt: '2026-06-09T00:00:00.000Z'
  },
  {
    total: 74,
    pillars: [
      { key: 'brand', label: 'Профессиональный бренд', score: 17 },
      { key: 'people', label: 'Поиск нужных людей', score: 15 },
      { key: 'insights', label: 'Обмен инсайтами', score: 25 },
      { key: 'relationships', label: 'Построение связей', score: 17 }
    ],
    capturedAt: '2026-06-16T00:00:00.000Z'
  },
  DEMO_SSI
]

/**
 * Seed incoming profile-views (WVMP) so the dashboard trend renders in demo mode.
 * Replaced live by the first real PROFILE_VIEWS_SNAPSHOT. NOT real data.
 */
export const DEMO_PROFILE_VIEWS: ProfileViewsSnapshot = {
  count: 45,
  windowDays: 90,
  capturedAt: '2026-06-23T00:00:00.000Z'
}

export const DEMO_PROFILE_VIEWS_HISTORY: ProfileViewsSnapshot[] = [
  { count: 28, windowDays: 90, capturedAt: '2026-06-09T00:00:00.000Z' },
  { count: 36, windowDays: 90, capturedAt: '2026-06-16T00:00:00.000Z' },
  DEMO_PROFILE_VIEWS
]

/** Placeholder inbound interest — real detection lands in a later phase. */
export const DEMO_LEADS: InboundLead[] = [
  { id: '1', name: 'Anna K.', role: 'Tech Recruiter · Revolut', signal: 'messaged' },
  { id: '2', name: 'Maksim R.', role: 'Talent Lead · Wise', signal: 'messaged' },
  { id: '3', name: 'Sofia D.', role: 'Head of Eng · seed startup', signal: 'viewed', count: 3 },
  { id: '4', name: 'James L.', role: 'IT Recruiter · freelance', signal: 'viewed' },
  { id: '5', name: 'Elena V.', role: 'Sourcing · Booking.com', signal: 'messaged' }
]
