import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { webPushConfig } from "../core/config.ts"
import { getDeviceTokenStore } from "../coordinator/device-tokens.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Push registration, mounted at `/api/push`. A client registers its push
 * destination here after sign-in and drops it on sign-out — an APNs device
 * token (native app) or a Web Push subscription (browser / installed PWA).
 * Behind the same session gate as every `/api/*` route, so the caller's session
 * (cookie or `x-api-key`) both authenticates the request and names the tenant
 * the device belongs to — the body never carries a tenant.
 */
const registerBody = z
  .object({
    platform: z.enum(["ios", "android", "web"]).default("ios"),
    /** APNs device token (native). */
    token: z.string().min(1).optional(),
    /** Web Push subscription (browser / PWA). */
    subscription: z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
      })
      .optional(),
  })
  .refine((body) => (body.platform === "web" ? Boolean(body.subscription) : Boolean(body.token)), {
    message: "web registration needs a subscription; native needs a token",
  })

export const pushRoutes = new Hono<SessionEnv>()
  // The client fetches this before subscribing — it is the `applicationServerKey`
  // `PushManager.subscribe` requires. Empty when web push is unconfigured, which
  // the client reads as "web push is off, don't offer it".
  .get("/vapid-public-key", (context) => {
    return context.json({ publicKey: webPushConfig()?.publicKey ?? null })
  })
  .post("/register", zValidator("json", registerBody), (context) => {
    const { tenantId } = context.get("caller")
    const body = context.req.valid("json")
    const store = getDeviceTokenStore()
    if (body.platform === "web" && body.subscription) {
      store.register(tenantId, body.subscription.endpoint, "web", body.subscription.keys)
    } else if (body.token) {
      store.register(tenantId, body.token, body.platform)
    }
    return context.json({ registered: true }, 201)
  })
  .delete("/token", zValidator("json", z.object({ token: z.string().min(1) })), (context) => {
    const { tenantId } = context.get("caller")
    getDeviceTokenStore().unregister(tenantId, context.req.valid("json").token)
    return context.json({ removed: true })
  })

export type PushRoutes = typeof pushRoutes
