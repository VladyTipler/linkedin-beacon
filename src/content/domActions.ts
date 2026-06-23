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

function placeCaretAtEnd(el: HTMLElement): void {
  const selection = window.getSelection()
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
