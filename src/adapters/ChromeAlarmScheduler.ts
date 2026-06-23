import type { AlarmScheduler } from '@lib/ports'

/** chrome.alarms-backed scheduler — survives SW eviction (the alarm wakes it). */
export class ChromeAlarmScheduler implements AlarmScheduler {
  schedule(name: string, whenMs: number): void {
    chrome.alarms.create(name, { when: whenMs })
  }

  clear(name: string): void {
    void chrome.alarms.clear(name)
  }
}
