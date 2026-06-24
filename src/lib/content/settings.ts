import type { KeyValueStore } from '../ports'

export const CONTENT_SETTINGS_KEY = 'content:settings'

/** The user's post-generator voice/structure prompt. */
export interface ContentSettings {
  postPrompt: string
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
  return { postPrompt: raw?.postPrompt?.trim() ? raw.postPrompt : DEFAULT_POST_PROMPT }
}

export async function saveContentSettings(store: KeyValueStore, s: ContentSettings): Promise<void> {
  await store.set(CONTENT_SETTINGS_KEY, s)
}
