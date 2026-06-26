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

  const editor = await waitForValue<HTMLElement>(() => document.querySelector<HTMLElement>(EDITOR), 5000)
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
  const { editor, shadow } = handle

  editor.focus()
  placeCaretAtEnd(editor, shadow)
  for (const char of [...text]) {
    root.execCommand('insertText', false, char)
    await sleep(delay.nextMs(40, 160))
  }

  // Quill registers via MutationObserver → the Post button enables on a later tick.
  // Re-query the button each poll/click via findComposer: artdeco/Ember may REPLACE
  // the button node on the disabled→enabled re-render, so a captured reference would
  // read a stale `disabled=true` forever (a false post_button_disabled failure).
  const ready = await waitForCond(() => findComposer(root)?.post.disabled === false, 4000)
  if (!ready) {
    await dismissComposer(shadow)
    return { ok: false, reason: 'post_button_disabled' }
  }
  findComposer(root)?.post.click()

  // Generous close-detection: a slow network can delay the modal teardown; too short a
  // window yields a false-negative (post landed, we report failure → draft kept → re-post).
  const closed = await waitForCond(() => findComposer(root) === null, 12000)
  if (!closed) {
    await dismissComposer(shadow)
    return { ok: false, reason: 'modal_did_not_close' }
  }
  return { ok: true }
}

/** Abandon the composer cleanly: Dismiss → confirm Discard (NOT "Save as draft"). */
async function dismissComposer(shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLElement>(DISMISS)?.click()
  const discard = await waitForValue(
    () =>
      [...shadow.querySelectorAll<HTMLElement>('button')].find(
        (b) => (b.textContent ?? '').trim().toLowerCase() === 'discard'
      ) ?? null,
    2000
  )
  discard?.click()
}

/** Caret at the end of `el`; selection scoped to `shadow` when the editor lives in one. */
function placeCaretAtEnd(el: HTMLElement, shadow?: ShadowRoot): void {
  const selection =
    (shadow as unknown as { getSelection?: () => Selection | null } | undefined)?.getSelection?.() ??
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

// ── Smart Connect: people-search invite. Connect control is an <a>; the invite
// modal renders ASYNC in the #interop-outlet shadow root (same host as composer).
// See docs/linkedin-dom-anchors.md "Smart Connect". ──
const SEND_NO_NOTE = 'button[aria-label="Send without a note"]'
const INVITE_DISMISS = 'button[aria-label="Dismiss"]'

/** The live invite-modal's "Send without a note" button (re-queried each poll). */
function findSendNoNote(root: ParentNode): HTMLButtonElement | null {
  const shadow = (root.querySelector(SHADOW_HOST) as HTMLElement | null)?.shadowRoot ?? null
  return shadow?.querySelector<HTMLButtonElement>(SEND_NO_NOTE) ?? null
}

/**
 * Send a bare connection request to a harvested candidate: click the Connect `<a>`
 * (located by member id), wait for the shadow invite modal, click "Send without a
 * note", confirm it closed. On failure → Dismiss. Edge — the real send is exercised
 * live, not in jsdom.
 */
export async function executeConnect(
  root: Document,
  candidate: { memberId: string; name: string },
  delay: HumanDelay
): Promise<ActionResult> {
  const anchor = root.querySelector<HTMLElement>(
    `a[componentkey*="member:${candidate.memberId}_connect"]`
  )
  if (!anchor) return { ok: false, reason: 'connect_anchor_not_found' }
  anchor.click()

  const send = await waitForValue(() => findSendNoNote(root), 6000)
  if (!send) {
    ;(root.querySelector(SHADOW_HOST) as HTMLElement | null)?.shadowRoot
      ?.querySelector<HTMLElement>(INVITE_DISMISS)
      ?.click()
    return { ok: false, reason: 'send_button_not_found' }
  }
  await sleep(delay.nextMs(300, 900)) // brief human pause before sending
  send.click()

  const closed = await waitForCond(() => findSendNoNote(root) === null, 6000)
  if (!closed) return { ok: false, reason: 'modal_did_not_close' }
  return { ok: true }
}
