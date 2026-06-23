import type { TabController } from '@lib/ports'

const SSI_URL = 'https://www.linkedin.com/sales/ssi'

/**
 * Opens /sales/ssi for a background refresh without disturbing the user.
 *
 * Primary path: a background (inactive) tab in the user's existing window.
 * It loads and runs the content script while staying unfocused, so the page
 * parses exactly as on a normal visit — and nothing pops up on screen
 * (at most a tab briefly appears in the strip, then is removed).
 *
 * Fallback (only when no normal window exists, e.g. all windows closed but
 * Chrome still running): an unfocused worker window. We deliberately do NOT
 * use `state: 'minimized'` — many window managers ignore it on create and
 * flash the window before minimizing it. An unfocused window is the least
 * intrusive reliable option for this rare edge case.
 *
 * Thin edge adapter — the only place the refresh pipeline touches
 * chrome.windows/tabs (DIP boundary).
 */
export class ChromeTabController implements TabController {
  private createdWindowId: number | null = null

  async openSsiTab(): Promise<number> {
    const targetWindowId = await this.findNormalWindowId()

    if (targetWindowId != null) {
      const tab = await chrome.tabs.create({
        url: SSI_URL,
        active: false,
        windowId: targetWindowId
      })
      if (tab.id == null) {
        throw new Error('ChromeTabController: background tab has no id')
      }
      return tab.id
    }

    // No normal window to host a background tab — open an unfocused worker
    // window as a last resort (rare).
    const win = await chrome.windows.create({
      url: SSI_URL,
      focused: false
    })
    this.createdWindowId = win.id ?? null
    const tabId = win.tabs?.[0]?.id
    if (tabId == null) {
      throw new Error('ChromeTabController: worker window has no tab id')
    }
    return tabId
  }

  async close(tabId: number): Promise<void> {
    // If we created a fallback window, dispose the whole window.
    if (this.createdWindowId != null) {
      const id = this.createdWindowId
      this.createdWindowId = null
      try {
        await chrome.windows.remove(id)
        return
      } catch {
        // Window already gone — fall through to tab removal as a safety net.
      }
    }
    try {
      await chrome.tabs.remove(tabId)
    } catch {
      // Tab already closed by the user or navigation — nothing to clean up.
    }
  }

  /**
   * Returns the id of a normal browser window to host the background tab,
   * preferring the last-focused one. Returns null if none exists.
   */
  private async findNormalWindowId(): Promise<number | null> {
    try {
      const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] })
      if (focused?.id != null && focused.type === 'normal') {
        return focused.id
      }
    } catch {
      // getLastFocused can reject when no matching window exists — fall back.
    }

    try {
      const all = await chrome.windows.getAll({ windowTypes: ['normal'] })
      const normal = all.find((w) => w.type === 'normal' && w.id != null)
      return normal?.id ?? null
    } catch {
      return null
    }
  }
}
