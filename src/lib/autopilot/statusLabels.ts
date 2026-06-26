// Human-readable status strings for the on-page activity overlay, so the user
// can tell "working slowly (anti-ban)" from "stuck" — the anti-ban pacing and
// the 1–3 min human breaks otherwise look like a freeze. Pure — no DOM.

export const SCANNING = 'Сканирую ленту…'
export const LIKING = 'Ставлю лайк…'
export const COMMENTING = 'Пишу комментарий…'
/** Idle label while a content-only run scrolls to gather enough signal. */
export const COLLECTING_IDEAS = 'Собираю идеи…'
/** Shown at the moment the buffer is sent to the LLM for extraction. */
export const GENERATING_IDEAS = 'Генерирую идеи…'
/** Shown while the approved draft is being typed + posted into the composer. */
export const PUBLISHING = 'Публикую…'
/** Smart Connect: scrolling the people-search results to load candidate cards. */
export const SEARCHING_PEOPLE = 'Ищу людей…'
/** Smart Connect: sending a connection request. */
export const CONNECTING = 'Добавляю в сеть…'

/** "Пауза 22с" — the anti-ban gap before the next action. */
export function pauseLabel(ms: number): string {
  return `Пауза ${Math.max(1, Math.round(ms / 1000))}с`
}

/** "Перерыв 2 мин ☕" — the occasional longer human break. */
export function breakLabel(ms: number): string {
  return `Перерыв ${Math.max(1, Math.round(ms / 60000))} мин ☕`
}
