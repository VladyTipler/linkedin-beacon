import type { KeyValueStore } from '../ports'
import type { CommentTone } from '../types'
import { DEFAULT_POSTS_PER_WEEK } from './PostWeekBudget'
import { asArray } from '../engagement/settings'

export const CONTENT_SETTINGS_KEY = 'content:settings'

/** The user's post-generator voice/structure prompt + auto-comment config. */
export interface ContentSettings {
  postPrompt: string
  /** Auto-comment during the run (off by default — comments are irreversible). */
  commentsEnabled: boolean
  /** Max auto-comments per day (anti-ban + quality over volume). */
  commentsPerDay: number
  /** Voice of the generated comment. */
  commentTone: CommentTone
  /** Weekly publish cap — a safety limit on the manual approve-first publish (anti-ban). */
  postsPerWeek: number
  /** Language for generated posts AND comments (Vlad targets USD-remote → English). */
  contentLanguage: string
  /** Days of week when auto-publish can run (0=Sunday..6=Saturday). */
  publishDays: number[]
}

export const DEFAULT_COMMENTS_PER_DAY = 5
export const DEFAULT_CONTENT_LANGUAGE = 'en'
export const DEFAULT_PUBLISH_DAYS = [1, 3, 5] // Mon, Wed, Fri (Date.getDay: 0=Sun..6=Sat)

const LANG_NAMES: Record<string, string> = { en: 'English', ru: 'Russian' }

function sanitiseDays(raw: unknown): number[] {
  if (raw == null) return DEFAULT_PUBLISH_DAYS
  const days = asArray<number>(raw)
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  return [...new Set(days)].sort((a, b) => a - b)
}

/** Human-readable language name for prompt injection (defaults to English). */
export function languageName(code: string): string {
  return LANG_NAMES[code] ?? 'English'
}

/** Sensible default so generation works before the user customises it. */
export const DEFAULT_POST_PROMPT = [
  'Write a single LinkedIn post in my voice.',
  'Open with a concrete hook (no "I am excited to share").',
  'Body: one specific insight from my own experience — not generic advice.',
  'Keep it under 1300 characters, short paragraphs, no hashtag spam (0–3 max).',
  'No emojis-as-bullets. End with a question or a takeaway, not a CTA to like/follow.'
].join(' ')

export async function loadContentSettings(store: KeyValueStore): Promise<ContentSettings> {
  const raw = await store.get<ContentSettings>(CONTENT_SETTINGS_KEY)
  return {
    postPrompt: raw?.postPrompt?.trim() ? raw.postPrompt : DEFAULT_POST_PROMPT,
    commentsEnabled: raw?.commentsEnabled === true,
    commentsPerDay:
      typeof raw?.commentsPerDay === 'number' && raw.commentsPerDay > 0
        ? raw.commentsPerDay
        : DEFAULT_COMMENTS_PER_DAY,
    commentTone: raw?.commentTone ?? 'expert',
    postsPerWeek:
      typeof raw?.postsPerWeek === 'number' && raw.postsPerWeek > 0
        ? raw.postsPerWeek
        : DEFAULT_POSTS_PER_WEEK,
    contentLanguage: raw?.contentLanguage?.trim() ? raw.contentLanguage : DEFAULT_CONTENT_LANGUAGE,
    publishDays: sanitiseDays(raw?.publishDays)
  }
}

export async function saveContentSettings(store: KeyValueStore, s: ContentSettings): Promise<void> {
  await store.set(CONTENT_SETTINGS_KEY, s)
}
