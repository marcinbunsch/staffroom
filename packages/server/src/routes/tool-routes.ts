import { zValidator } from "@hono/zod-validator"
import { ToolCredentialInput } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { getToolCredentialStore } from "../coordinator/tool-credentials.ts"
import type { SessionEnv } from "../middleware/session.ts"
import { toolCatalog } from "../tools/registry.ts"

/**
 * The tool catalog and its credentials. The catalog itself is read-only (it is
 * code); what a client manages here is credentials — an org secret (admin only,
 * because it spends the organization's money and runs for everyone) or a
 * personal connection. Secrets are write-only over the API: they go in, and
 * only a label and a hint come back.
 *
 * Mounted at `/api/tools`, so the paths here are relative — that keeps the type
 * (`ToolRoutes`) clean for the Hono RPC client. Handlers are chained (RPC infers
 * the client from the chain) and validated with `zValidator`.
 */
export const toolRoutes = new Hono<SessionEnv>()
  .get("/", (context) => context.json({ tools: toolCatalog() }))
  .get("/credentials", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ credentials: getToolCredentialStore().list(tenantId) })
  })
  .put(
    "/credentials",
    zValidator("json", ToolCredentialInput, (result, context) => {
      if (!result.success)
        return context.json({ error: "invalid_credential", issues: result.error.issues }, 400)
    }),
    (context) => {
      const caller = context.get("caller")
      const input = context.req.valid("json")
      if (input.scope === "org" && caller.role !== "admin") {
        return context.json({ error: "admin_required" }, 403)
      }
      const credential = getToolCredentialStore().put(caller.tenantId, input)
      return context.json({ credential }, 201)
    },
  )
  .delete("/credentials/:id", zValidator("param", z.object({ id: z.string() })), (context) => {
    const caller = context.get("caller")
    const store = getToolCredentialStore()
    const credential = store.get(caller.tenantId, context.req.valid("param").id)
    if (!credential) return context.json({ error: "unknown_credential" }, 404)
    if (credential.scope === "org" && caller.role !== "admin") {
      return context.json({ error: "admin_required" }, 403)
    }
    store.remove(caller.tenantId, credential.id)
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<ToolRoutes>`). */
export type ToolRoutes = typeof toolRoutes
