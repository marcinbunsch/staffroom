import { Hono } from "hono"
import { singleUserMode } from "../core/config.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * The session identity endpoint, mounted at `/api/me`. The UI reads this before
 * it can compose a session key for the agent route (the tenant is part of that
 * key). The tenant comes from the authenticated caller, never the request.
 * `singleUser` tells the UI to hide what only matters with more than one
 * account — teams, accounts & roles, signing out.
 */
export const apiRoutes = new Hono<SessionEnv>().get("/", (context) => {
  const caller = context.get("caller")
  return context.json({
    tenantId: caller.tenantId,
    role: caller.role,
    singleUser: singleUserMode(),
  })
})

export type MeRoutes = typeof apiRoutes
