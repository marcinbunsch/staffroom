import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import type { Context } from "hono"
import { z } from "zod"
import { getTeamStore } from "../coordinator/teams.ts"
import { getToolsetStore } from "../coordinator/toolsets.ts"
import { singleUserMode } from "../core/config.ts"
import type { SessionEnv } from "../middleware/session.ts"
import { grantIntegration } from "../tools/mcp.ts"
import { toolCatalog } from "../tools/registry.ts"

/**
 * Teams — the tool-grant authorization layer. Entirely admin-managed: an admin
 * creates teams, sets their members and their toolset grants. There is nothing
 * a non-admin reads here, except `/grants/me` (the caller's own usable toolsets).
 *
 * Mounted at `/api/teams`, so the paths here are relative — that keeps the type
 * (`TeamRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator`.
 */
function admin(context: Context<SessionEnv>): boolean {
  return context.get("caller").role === "admin"
}

const idParam = z.object({ id: z.string() })

export const teamRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    if (!admin(context)) return context.json({ error: "admin_required" }, 403)
    return context.json({ teams: getTeamStore().listDetail() })
  })
  // The one thing a non-admin may read: the toolsets their own teams make usable —
  // the same set the agent path resolves. A toolset counts only if its own key is
  // granted AND, when it is backed by an integration, that integration is granted
  // too (the second gate). Lets a config screen offer only usable toolsets. On a
  // single-user server no team gates anything, so every toolset is usable.
  .get("/grants/me", (context) => {
    if (singleUserMode()) return context.json({ toolsets: everyToolsetKey() })
    const store = getTeamStore()
    const userId = context.get("caller").tenantId
    const integrations = store.grantedIntegrations(userId)
    const usable = [...store.grantedToolsets(userId)].filter((grant) => {
      const integration = grantIntegration(grant)
      return integration === undefined || integrations.has(integration)
    })
    return context.json({ toolsets: usable })
  })
  .post("/", zValidator("json", z.object({ name: z.string() })), (context) => {
    if (!admin(context)) return context.json({ error: "admin_required" }, 403)
    const { name } = context.req.valid("json")
    return context.json({ team: getTeamStore().create(name) })
  })
  .patch(
    "/:id",
    zValidator("param", idParam),
    zValidator("json", z.object({ name: z.string() })),
    (context) => {
      if (!admin(context)) return context.json({ error: "admin_required" }, 403)
      const team = getTeamStore().rename(
        context.req.valid("param").id,
        context.req.valid("json").name,
      )
      if (!team) return context.json({ error: "unknown_team" }, 404)
      return context.json({ team })
    },
  )
  .delete("/:id", zValidator("param", idParam), (context) => {
    if (!admin(context)) return context.json({ error: "admin_required" }, 403)
    return context.json({ removed: getTeamStore().remove(context.req.valid("param").id) })
  })
  .put(
    "/:id/members",
    zValidator("param", idParam),
    zValidator("json", z.object({ userIds: z.array(z.string()) })),
    (context) => {
      if (!admin(context)) return context.json({ error: "admin_required" }, 403)
      const store = getTeamStore()
      const { id } = context.req.valid("param")
      if (!store.get(id)) return context.json({ error: "unknown_team" }, 404)
      store.setMembers(id, context.req.valid("json").userIds)
      return context.json({ ok: true })
    },
  )
  .put(
    "/:id/grants",
    zValidator("param", idParam),
    zValidator("json", z.object({ toolsets: z.array(z.string()) })),
    (context) => {
      if (!admin(context)) return context.json({ error: "admin_required" }, 403)
      const store = getTeamStore()
      const { id } = context.req.valid("param")
      if (!store.get(id)) return context.json({ error: "unknown_team" }, 404)
      store.setGrants(id, context.req.valid("json").toolsets)
      return context.json({ ok: true })
    },
  )
  .put(
    "/:id/integration-grants",
    zValidator("param", idParam),
    zValidator("json", z.object({ integrations: z.array(z.string()) })),
    (context) => {
      if (!admin(context)) return context.json({ error: "admin_required" }, 403)
      const store = getTeamStore()
      const { id } = context.req.valid("param")
      if (!store.get(id)) return context.json({ error: "unknown_team" }, 404)
      store.setIntegrationGrants(id, context.req.valid("json").integrations)
      return context.json({ ok: true })
    },
  )

/** Every grantable toolset key: catalog tools by name, configured toolsets as `<kind>:<name>`. */
function everyToolsetKey(): string[] {
  return [
    ...toolCatalog().map((tool) => tool.name),
    ...getToolsetStore()
      .list()
      .map((toolset) => `${toolset.kind}:${toolset.name}`),
  ]
}

/** The router's type, for the Hono RPC client (`hc<TeamRoutes>`). */
export type TeamRoutes = typeof teamRoutes
