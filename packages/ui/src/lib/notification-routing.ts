import { useEffect } from "react"
import { useNavigate } from "react-router"

/**
 * Route a tapped push notification to the right chat.
 *
 * When the app is already open, the service worker posts a `notification-click`
 * message with the target path (see `public/service-worker.js`); this listens
 * for it and navigates in place. The cold-start case needs nothing here — the
 * worker opens the path directly, so react-router renders the right screen on
 * load. Mounted once, inside the router.
 */
export function useNotificationRouting(): void {
  const navigate = useNavigate()
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const handler = (event: MessageEvent) => {
      const message = event.data
      if (message?.type === "notification-click" && typeof message.path === "string") {
        navigate(message.path)
      }
    }
    navigator.serviceWorker.addEventListener("message", handler)
    return () => navigator.serviceWorker.removeEventListener("message", handler)
  }, [navigate])
}
