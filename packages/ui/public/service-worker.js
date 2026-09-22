/**
 * Staffroom service worker — the web/PWA half of push notifications.
 *
 * It exists for one reason: a `push` event can only be received in a service
 * worker, and only a service worker may show a notification while the page is
 * closed. So this is deliberately tiny — no offline caching, no asset
 * interception. It receives the encrypted payload the server sent (see
 * `coordinator/web-push.ts`), shows it, keeps the app-icon badge in sync, and
 * routes a tap back to the app.
 */

// Take over as soon as it installs, so the first enable works without a reload.
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("push", (event) => {
  const payload = readPayload(event)
  if (!payload) return
  const { title, body, badge, threadId, data } = payload

  const show = self.registration.showNotification(title ?? "Staffroom", {
    body: body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Collapse repeats for the same chat into one notification.
    tag: threadId,
    renotify: Boolean(threadId),
    data: data ?? {},
  })

  // Keep the app-icon badge honest even when the app is not open.
  if (typeof badge === "number" && self.navigator.setAppBadge) {
    if (badge > 0) self.navigator.setAppBadge(badge).catch(() => {})
    else self.navigator.clearAppBadge?.().catch(() => {})
  }

  event.waitUntil(show)
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  event.waitUntil(focusApp(event.notification.data ?? {}))
})

function readPayload(event) {
  if (!event.data) return undefined
  try {
    return event.data.json()
  } catch {
    return { title: "Staffroom", body: event.data.text() }
  }
}

/**
 * Focus an existing app window and tell it where to go, or cold-open one at the
 * target path. Warm: post `notification-click` with the path so the running app
 * routes in place. Cold: open the path directly, so react-router renders the
 * right chat on load. The target is the agent's chat when the payload names one.
 */
async function focusApp(data) {
  const path = data && data.agent ? `/a/${encodeURIComponent(data.agent)}` : "/"
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  const existing = all.find((client) => "focus" in client)
  if (existing) {
    existing.postMessage({ type: "notification-click", data, path })
    return existing.focus()
  }
  return self.clients.openWindow(path)
}
