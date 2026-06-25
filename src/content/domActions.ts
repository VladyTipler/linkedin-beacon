// Content-script DOM action executors — the ONLY code that mutates LinkedIn.
// Thin edge over FeedReader (locate) + validated techniques (see
// docs/linkedin-dom-anchors.md). Real like-toggle / comment-submit acceptance is
// confirmed in field tests; the locate + skip-if-liked logic is unit-tested.

import { FeedReader } from '@lib/feed/FeedReader'
import type { HumanDelay } from '@lib/engagement/HumanDelay'

const REACTION = 'button[aria-label^="Reaction button state"]'
const NOT_LIKED = 'Reaction button state: no reaction'
const COMMENT_BTN = 'button[aria-label="Comment"]'
const EDITOR = '[data-testid="ui-core-tiptap-text-editor-wrapper"] [contenteditable="true"]'

// ── Post composer (share box). Lives in a SHADOW DOM; editor is Quill, which
// commits its model ASYNCHRONOUSLY. See docs/linkedin-dom-anchors.md "Post composer". ──
const POST_TRIGGER = '[aria-label="Start a post"]'
const SHADOW_HOST = '#interop-outlet'
const QL_EDITOR = '[data-test-ql-editor-contenteditable="true"]'
const POST_SUBMIT = 'button.share-actions__primary-action'
const DISMISS = 'button[aria-label="Dismiss"]'

export type ActionResult = { ok: true; already?: boolean } | { ok: false; reason: string }

const reader = new FeedReader()

/** Like a post by urn. No-op (success) if already liked — like dedup. */
export function executeLike(root: ParentNode, urn: string): ActionResult {
  const post = reader.findByUrn(root, urn)
  if (!post) return { ok: false, reason: 'post_not_found' }
  const button = post.querySelector<HTMLElement>(REACTION)
  if (!button) return { ok: false, reason: 'like_button_not_found' }
  if (button.getAttribute('aria-label') !== NOT_LIKED) return { ok: true, already: true }
  button.click()
  return { ok: true }
}

/**
 * Comment on a post: open the editor, type the text char-by-char (ProseMirror
 * accepts execCommand insertText — validated live), then submit. Human-paced via
 * the injected HumanDelay. Edge — exercised in field tests, not jsdom.
 */
export async function executeComment(
  root: ParentNode,
  urn: string,
  text: string,
  delay: HumanDelay
): Promise<ActionResult> {
  const post = reader.findByUrn(root, urn)
  if (!post) return { ok: false, reason: 'post_not_found' }
  const open = post.querySelector<HTMLElement>(COMMENT_BTN)
  if (!open) return { ok: false, reason: 'comment_button_not_found' }
  open.click()

  const editor = await waitFor<HTMLElement>(() => document.querySelector(EDITOR), 5000)
  if (!editor) return { ok: false, reason: 'editor_not_found' }
  editor.focus()
  placeCaretAtEnd(editor)

  for (const char of [...text]) {
    document.execCommand('insertText', false, char)
    await sleep(delay.nextMs(40, 160))
  }

  const submit = findSubmit(post)
  if (!submit) return { ok: false, reason: 'submit_not_found' }
  submit.click()
  return { ok: true }
}

/** The enabled comment-submit button (label confirmed in field test). */
function findSubmit(post: Element): HTMLElement | null {
  const buttons = Array.from(post.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
  return (
    buttons.find(
      (b) =>
        !b.disabled &&
        /^(comment|post|reply)$/i.test((b.getAttribute('aria-label') ?? '').trim())
    ) ?? null
  )
}

export interface ComposerHandle {
  editor: HTMLElement
  post: HTMLButtonElement
  shadow: ShadowRoot
}

/**
 * Locate the composer editor + Post button STRICTLY inside #interop-outlet's open
 * shadow root. A plain document query would grab the decoy `.ql-editor` in the hidden
 * `/preload` iframe — so we never query globally. Returns null if the modal isn't open.
 */
export function findComposer(root: ParentNode): ComposerHandle | null {
  const host = root.querySelector(SHADOW_HOST) as HTMLElement | null
  const shadow = host?.shadowRoot ?? null
  if (!shadow) return null
  const editor = shadow.querySelector<HTMLElement>(QL_EDITOR)
  const post = shadow.querySelector<HTMLButtonElement>(POST_SUBMIT)
  if (!editor || !post) return null
  return { editor, post, shadow }
}

/**
 * Publish a post: open the composer, type the text char-by-char (Quill accepts
 * execCommand insertText, but commits its model ASYNCHRONOUSLY — so we POLL the Post
 * button until it enables before clicking), submit, confirm the modal closed. On any
 * failure → Dismiss → Discard (never leave a half-draft). Edge — the typing path is
 * exercised live, not in jsdom.
 */
export async function executeComposerPost(
  root: Document,
  text: string,
  delay: HumanDelay
): Promise<ActionResult> {
  if (!text.trim()) return { ok: false, reason: 'empty_text' }
  const trigger = root.querySelector<HTMLElement>(POST_TRIGGER)
  if (!trigger) return { ok: false, reason: 'composer_trigger_not_found' }
  trigger.click()

  const handle = await waitForValue(() => findComposer(root), 6000)
  if (!handle) return { ok: false, reason: 'composer_not_found' }
  const { editor, post, shadow } = handle

  editor.focus()
  placeCaretAtEndIn(editor, shadow)
  for (const char of [...text]) {
    document.execCommand('insertText', false, char)
    await sleep(delay.nextMs(40, 160))
  }

  // Quill registers via MutationObserver → the Post button enables on a later tick.
  const ready = await waitForCond(() => !post.disabled, 4000)
  if (!ready) {
    await dismissComposer(root, shadow)
    return { ok: false, reason: 'post_button_disabled' }
  }
  post.click()

  const closed = await waitForCond(() => findComposer(root) === null, 8000)
  if (!closed) {
    await dismissComposer(root, shadow)
    return { ok: false, reason: 'modal_did_not_close' }
  }
  return { ok: true }
}

/** Abandon the composer cleanly: Dismiss → confirm Discard (NOT "Save as draft"). */
async function dismissComposer(root: Document, shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLElement>(DISMISS)?.click()
  const discard = await waitForValue(() => {
    const host = root.querySelector(SHADOW_HOST) as HTMLElement | null
    const sr = host?.shadowRoot
    return (
      [...(sr?.querySelectorAll<HTMLElement>('button') ?? [])].find(
        (b) => (b.textContent ?? '').trim().toLowerCase() === 'discard'
      ) ?? null
    )
  }, 2000)
  discard?.click()
}

function placeCaretAtEnd(el: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Caret at end, selection scoped to the shadow root the editor lives in. */
function placeCaretAtEndIn(el: HTMLElement, shadow: ShadowRoot): void {
  const selection =
    (shadow as unknown as { getSelection?: () => Selection | null }).getSelection?.() ??
    window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor<T extends Element>(
  find: () => Element | null,
  timeoutMs: number
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = find()
    if (found) return found as T
    await sleep(100)
  }
  return null
}

/** Poll a predicate until true or timeout. Returns whether it became true. */
async function waitForCond(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) return true
    await sleep(100)
  }
  return false
}

/** Poll a factory until it returns non-null or timeout. */
async function waitForValue<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = find()
    if (v) return v
    await sleep(100)
  }
  return null
}
