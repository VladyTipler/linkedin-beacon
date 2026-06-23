import type { TabController } from '@lib/ports'

const SSI_URL = 'https://www.linkedin.com/sales/ssi'

/**
 * Opens /sales/ssi in a minimized, unfocused worker window so SSI can be
 * refreshed without disturbing the user's current window or requiring a
 * LinkedIn tab to be open. Thin edge adapter — the only place the refresh
 * pipeline touches chrome.windows/tabs (DIP boundary).
 *
 * A minimized window still loads the page and runs content scripts, so the
 * existing content script parses it exactly as on a normal visit. The whole
 * worker window is disposed on close.
 */
export class ChromeTabController implements TabController {
  private workerWindowId: number | null = null

  async openSsiTab(): Promise<number> {
    const win = await chrome.windows.create({
      url: SSI_URL,
      focused: false,
      state: 'minimized'
    })
    this.workerWindowId = win.id ?? null
    const tabId = win.tabs?.[0]?.id
    if (tabId == null) {
      throw new Error('ChromeTabController: worker window has no tab id')
    }
    return tabId
  }

  async close(tabId: number): Promise<void> {
    if (this.workerWindowId != null) {
      const id = this.workerWindowId
      this.workerWindowId = null
      await chrome.windows.remove(id)
      return
    }
    await chrome.tabs.remove(tabId)
  }
}
