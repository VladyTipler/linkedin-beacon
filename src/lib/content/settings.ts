import type { KeyValueStore } from '../ports'
import type { CommentTone } from '../types'
import { DEFAULT_POSTS_PER_WEEK } from './PostWeekBudget'

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
}

export const DEFAULT_COMMENTS_PER_DAY = 5
export const DEFAULT_CONTENT_LANGUAGE = 'en'

const LANG_NAMES: Record<string, string> = { en: 'English', ru: 'Russian' }

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
    contentLanguage: raw?.contentLanguage?.trim() ? raw.contentLanguage : DEFAULT_CONTENT_LANGUAGE
  }
}

export async function saveContentSettings(store: KeyValueStore, s: ContentSettings): Promise<void> {
  await store.set(CONTENT_SETTINGS_KEY, s)
}
