import type { PushRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** A Web Push subscription, the subset the server stores and encrypts against. */
export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Push registration — the client half of notifications. The browser (or native
 * shell) registers its destination here and drops it on sign-out; the server
 * fans escalations out to it. `vapidPublicKey` returns null when web push is
 * unconfigured on the server, which the UI reads as "don't offer it".
 */
export function pushDomain(ctx: DomainContext) {
  const rpc = hc<PushRoutes>(`${ctx.base}/api/push`, ctx.hcInit)
  return {
    vapidPublicKey: async (): Promise<string | null> => {
      const res = await rpc["vapid-public-key"].$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).publicKey
    },
    registerWeb: async (subscription: WebPushSubscription) => {
      const res = await rpc.register.$post({ json: { platform: "web", subscription } })
      if (!res.ok) throw await apiError(res)
    },
    unregister: async (token: string) => {
      const res = await rpc.token.$delete({ json: { token } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
