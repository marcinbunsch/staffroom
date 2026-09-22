import { isDesktopShell, setDesktopBadgeCounts } from "./use-desktop.ts"

/**
 * Keep the app-icon badge in step with the operator's unresolved work — the sum
 * of unread agent replies and open attention items, the same definition the
 * desktop shell uses.
 *
 * Two surfaces, one number. In the Electron shell the count goes through the
 * desktop bridge (`app.setBadgeCount`). In a browser or installed PWA it goes
 * through the web Badging API — visible only once the PWA is installed
 * (dock/taskbar, or the iOS 16.4+ home-screen icon), a harmless no-op in a plain
 * tab. While the app is open this tracks the live store counts; while it is
 * closed the service worker keeps the PWA badge current from each push. Both
 * carry the same total, so they converge.
 */
export function syncAppBadge(unread: number, attention: number): void {
  if (isDesktopShell()) {
    setDesktopBadgeCounts(unread, attention)
    return
  }
  setWebAppBadge(unread + attention)
}

function setWebAppBadge(total: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (!nav.setAppBadge) return
  const applied = total > 0 ? nav.setAppBadge(total) : (nav.clearAppBadge?.() ?? nav.setAppBadge(0))
  void Promise.resolve(applied).catch(() => {})
}
