import { type ApnsConfig, apnsConfig, webPushConfig, type WebPushConfig } from "../core/config.ts"
import { type ApnsAlert, sendApns } from "./apns.ts"
import { getAttentionStore } from "./attention.ts"
import { type DeviceToken, getDeviceTokenStore } from "./device-tokens.ts"
import { getUnreadStore } from "./unread.ts"
import { sendWebPush, type WebPushSubscription } from "./web-push.ts"

/**
 * Push dispatch — turn a tenant-scoped alert into device notifications.
 *
 * This is the reason the mobile app exists: an agent escalation reaches the
 * operator's pocket. It sits downstream of the attention/unread substrate — a
 * raise-site calls {@link notify}, this looks up the tenant's devices and fans
 * out over whichever channels are configured: APNs for `ios`, Web Push for
 * `web`. Off entirely until at least one is configured, so a dev or self-hosted
 * install without any push credentials simply never sends, no guards at the call
 * sites.
 *
 * A failed send never throws back into the write-path that rang it — the same
 * discipline the operator event bus keeps: badges are downstream of real work,
 * not it.
 */

/** What a caller asks to be delivered; the badge is computed here, not passed. */
export interface PushAlert {
  title: string
  body: string
  /** Groups notifications and routes the tap — a chat session or agent id. */
  threadId?: string
  /** Custom keys for the tap handler to deep-link with. */
  data?: Record<string, string>
}

/**
 * The badge for a tenant: unresolved work waiting on the operator. Open
 * attention items (escalations and approval gates) plus unread agent replies —
 * the two counts the roster already surfaces, summed into the one number a
 * badge shows.
 */
export function badgeCount(tenantId: string): number {
  const attention = getAttentionStore().open(tenantId).length
  const unread = Object.values(getUnreadStore().counts(tenantId)).reduce(
    (total, count) => total + count,
    0,
  )
  return attention + unread
}

/**
 * Deliver an alert to every device a tenant has registered. Fire-and-forget:
 * returns immediately, sends in the background, and prunes any registration a
 * push service reports as gone. A no-op when no push channel is configured or
 * the tenant has no devices.
 */
export function notify(tenantId: string, alert: PushAlert): void {
  const apns = apnsConfig()
  const web = webPushConfig()
  if (!apns && !web) return
  const devices = getDeviceTokenStore().list(tenantId)
  if (devices.length === 0) return

  const badge = badgeCount(tenantId)

  void Promise.all(
    devices.map(async (device) => {
      if (device.platform === "web") {
        if (web) await deliverWeb(web, device, alert, badge)
      } else if (apns) {
        await deliverApns(apns, device, alert, badge)
      }
    }),
  ).catch((error) => console.warn("[push] dispatch failed:", error))
}

async function deliverApns(
  config: ApnsConfig,
  device: DeviceToken,
  alert: PushAlert,
  badge: number,
): Promise<void> {
  const payload: ApnsAlert = {
    title: alert.title,
    body: alert.body,
    badge,
    threadId: alert.threadId,
    data: alert.data,
  }
  const result = await sendApns(config, device.token, payload)
  if (result.gone) getDeviceTokenStore().purge(device.token)
  else if (result.status !== 200) warnSend("APNs", result.status, result.reason, device.platform)
}

async function deliverWeb(
  config: WebPushConfig,
  device: DeviceToken,
  alert: PushAlert,
  badge: number,
): Promise<void> {
  if (!device.keys) return
  const subscription: WebPushSubscription = { endpoint: device.token, keys: device.keys }
  const result = await sendWebPush(config, subscription, {
    title: alert.title,
    body: alert.body,
    badge,
    threadId: alert.threadId,
    data: alert.data,
  })
  // A push service returns 201 Created on success; anything else is worth a line.
  if (result.gone) getDeviceTokenStore().purge(device.token)
  else if (result.status !== 201) warnSend("Web Push", result.status, undefined, device.platform)
}

function warnSend(channel: string, status: number, reason: string | undefined, platform: string) {
  console.warn(`[push] ${channel} ${status}${reason ? ` ${reason}` : ""} for a ${platform} device`)
}
