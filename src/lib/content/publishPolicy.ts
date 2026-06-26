import type { Draft } from '../types'

export function shouldPublishToday(args: {
  weekday: number; publishDays: number[]; remainingPosts: number; hasApproved: boolean
}): boolean {
  return args.publishDays.includes(args.weekday) && args.remainingPosts > 0 && args.hasApproved
}

export function pickOldestApproved(drafts: Draft[]): Draft | null {
  const approved = drafts.filter((d) => d.approved)
  if (!approved.length) return null
  return approved.reduce((oldest, d) => (d.createdAt < oldest.createdAt ? d : oldest))
}
