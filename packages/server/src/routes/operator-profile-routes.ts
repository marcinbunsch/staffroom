import { zValidator } from "@hono/zod-validator"
import { OperatorProfileInput } from "@staffroom/protocol"
import { Hono } from "hono"
import { getOperatorProfileStore } from "../coordinator/operator-profile.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * The operator profile — who this account's staff work for. Per-tenant, so
 * every handler reads and writes the caller's own tenant and never a path
 * parameter. `OperatorProfileInput` caps the length at the boundary (a 400),
 * because the text rides in every agent's prompt on every turn.
 *
 * Mounted at `/api/operator/profile`, relative-pathed so the type
 * (`OperatorProfileRoutes`) stays clean for the Hono RPC client.
 */
export const operatorProfileRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ profile: getOperatorProfileStore().get(tenantId) })
  })
  .put("/", zValidator("json", OperatorProfileInput), (context) => {
    const { tenantId } = context.get("caller")
    const { text } = context.req.valid("json")
    return context.json({ profile: getOperatorProfileStore().set(tenantId, text) })
  })

/** The router's type, for the Hono RPC client (`hc<OperatorProfileRoutes>`). */
export type OperatorProfileRoutes = typeof operatorProfileRoutes
