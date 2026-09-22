/**
 * Browser push, the client half — permission, the service worker, and the
 * `PushManager` subscription, registered with the server.
 *
 * All the crypto and delivery live on the server (`coordinator/web-push.ts`);
 * this only asks the browser to subscribe and hands the resulting endpoint +
 * keys to `/api/push/register`. Everything is capability-gated: on a browser
 * without push, or a server without VAPID configured, {@link pushSupported} /
 * {@link pushAvailable} return false and the UI hides the control.
 */
import { api } from "./api.ts"

const SERVICE_WORKER_URL = "/service-worker.js"

export type PushState = "unsupported" | "denied" | "enabled" | "disabled"

/** Whether this browser has the APIs at all (Safari <16.4, private windows, …). */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

/** Whether the server has web push configured — null public key means "off". */
export async function pushAvailable(): Promise<boolean> {
  if (!pushSupported()) return false
  try {
    return (await api.push.vapidPublicKey()) !== null
  } catch {
    return false
  }
}

/** The current state, for the settings toggle to render from. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported"
  if (Notification.permission === "denied") return "denied"
  const subscription = await currentSubscription()
  return subscription ? "enabled" : "disabled"
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration()
  return registration ? registration.pushManager.getSubscription() : null
}

/**
 * Turn push on: register the worker, ask permission, subscribe, and register the
 * subscription with the server. Idempotent — an existing subscription is reused
 * and re-registered (the server upserts). Throws with a human-readable reason.
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("This browser does not support notifications.")

  const publicKey = await api.push.vapidPublicKey()
  if (!publicKey) throw new Error("Notifications are not configured on this server.")

  const permission = await Notification.requestPermission()
  if (permission !== "granted") throw new Error("Notification permission was not granted.")

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL)
  await navigator.serviceWorker.ready

  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }))

  await api.push.registerWeb(toServerSubscription(subscription))
}

/** Turn push off: unregister with the server, then drop the browser subscription. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  try {
    await api.push.unregister(subscription.endpoint)
  } finally {
    await subscription.unsubscribe()
  }
}

function toServerSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON()
  const keys = json.keys
  if (!keys?.p256dh || !keys.auth)
    throw new Error("The browser returned an incomplete subscription.")
  return { endpoint: subscription.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

/** VAPID public keys travel as base64url; `applicationServerKey` wants bytes. */
function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}
