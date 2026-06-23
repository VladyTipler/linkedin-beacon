import type { BeaconMessage } from '@lib/types'

/**
 * Thin wrapper over chrome.runtime for the side panel. Guards the non-extension
 * context (unit tests / plain browser) so components stay testable.
 */
export const panelBus = {
  available(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.runtime?.id
  },

  send(message: BeaconMessage): void {
    if (!this.available()) return
    chrome.runtime.sendMessage(message).catch(() => {})
  },

  onMessage(handler: (message: BeaconMessage) => void): () => void {
    if (!this.available()) return () => {}
    const listener = (message: BeaconMessage) => handler(message)
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }
}
