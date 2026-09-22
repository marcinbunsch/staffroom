import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { type SpendDimension, getAuditLog } from "../coordinator/audit.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Spend — a GROUP BY over the priced audit columns, which is the whole reason
 * usage is stored as columns and not a payload blob (M2).
 *
 * A caller sees their own spend, broken down by a dimension. The admin view adds
 * the across-tenants total, grouped by tenant — the one place a cross-tenant read
 * is allowed, and it is behind the admin role and a loudly-named route.
 *
 * Only model turns are priced; a tool call that costs money (a Firecrawl scrape)
 * does not appear. The page says so.
 *
 * Mounted at `/api/spend`, so the paths here are relative — that keeps the type
 * (`SpendRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator`.
 */
const DIMENSIONS = ["agent", "model", "session", "credential"] as const satisfies SpendDimension[]

export const spendRoutes = new Hono<SessionEnv>()
  .get(
    "/",
    zValidator("query", z.object({ dimension: z.enum(DIMENSIONS).default("agent") })),
    (context) => {
      const { tenantId } = context.get("caller")
      const dimension = context.req.valid("query").dimension
      const rows = getAuditLog().spend(tenantId, dimension, {
        since: context.req.query("since"),
        until: context.req.query("until"),
      })
      return context.json({ dimension, rows })
    },
  )
  .get("/admin", (context) => {
    if (context.get("caller").role !== "admin")
      return context.json({ error: "admin_required" }, 403)
    const rows = getAuditLog().spendAcrossTenants({
      since: context.req.query("since"),
      until: context.req.query("until"),
    })
    return context.json({ rows })
  })

/** The router's type, for the Hono RPC client (`hc<SpendRoutes>`). */
export type SpendRoutes = typeof spendRoutes
