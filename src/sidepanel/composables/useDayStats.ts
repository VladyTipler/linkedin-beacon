import { ref, onMounted, onUnmounted } from 'vue'
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore'
import { asArray } from '@lib/engagement/settings'
import type { RunReport } from '@lib/types'
import { panelBus } from '../lib/panelBus'

/**
 * Today's action tally — "what the bot has done so far today", read straight from the
 * per-module daily budgets (+ posts from today's run reports). The Dash shows this live
 * alongside the current step, so the user sees progress without opening Reports.
 *
 * Each budget is `{ day, used }`; we only count `used` when `day` is today (a stale
 * yesterday entry reads as 0). Posts are weekly-capped, so they're summed from today's
 * run reports instead.
 */
export interface DayStats {
  views: number
  connects: number
  ideas: number
  likes: number
  comments: number
  posts: number
}

const LIKE_BUDGET_KEY = 'engagement:budget:like'
const COMMENT_BUDGET_KEY = 'comments:budget'
const REPORTS_KEY = 'autopilot:reports'

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function dayUsed(d: unknown): number {
  if (d && typeof d === 'object' && 'day' in d && 'used' in d) {
    const obj = d as { day: unknown; used: unknown }
    return obj.day === todayKey() && typeof obj.used === 'number' ? obj.used : 0
  }
  return 0
}

export function useDayStats() {
  const stats = ref<DayStats>({ views: 0, connects: 0, ideas: 0, likes: 0, comments: 0, posts: 0 })

  const reload = async () => {
    if (!panelBus.available()) return
    const store = new ChromeStorageStore()
    const [views, connects, ideas, likes, comments, rawReports] = await Promise.all([
      store.get<{ day: string; used: number }>('views:daily'),
      store.get<{ day: string; used: number }>('connects:daily'),
      store.get<{ day: string; used: number }>('ideas:budget'),
      store.get<{ day: string; used: number }>(LIKE_BUDGET_KEY),
      store.get<{ day: string; used: number }>(COMMENT_BUDGET_KEY),
      store.get<RunReport[]>(REPORTS_KEY)
    ])
    const today = todayKey()
    const posts = asArray<RunReport>(rawReports)
      .filter((r) => (r.startedAt ?? '').startsWith(today))
      .flatMap((r) => r.modules)
      .filter((m) => m.id === 'content')
      .reduce((sum, m) => sum + (m.executed ?? 0), 0)
    stats.value = {
      views: dayUsed(views),
      connects: dayUsed(connects),
      ideas: dayUsed(ideas),
      likes: dayUsed(likes),
      comments: dayUsed(comments),
      posts
    }
  }

  // Refresh whenever the run progresses (status broadcast per action) or a report lands.
  let off = () => {}
  onMounted(() => {
    void reload()
    off = panelBus.onMessage((m) => {
      if (m.type === 'AUTOPILOT_STATUS' || m.type === 'AUTOPILOT_REPORT' || m.type === 'AUTOPILOT_STAGE') {
        void reload()
      }
    })
  })
  onUnmounted(() => off())

  return { stats, reload }
}
