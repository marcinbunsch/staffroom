import { zValidator } from "@hono/zod-validator"
import { McpDiscoveryInput, Toolset, ToolsetInput } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { getToolsetStore } from "../coordinator/toolsets.ts"
import { integrationBearer } from "../core/integrations.ts"
import type { SessionEnv } from "../middleware/session.ts"
import { discoverMcpTools } from "../tools/mcp-client.ts"
import { getToolsetType, listToolsetTools, toolsetKinds } from "../tools/toolset-types.ts"

/**
 * Toolsets — the "which tools do I want enabled" layer (MCP-backed toolsets).
 *
 * Registering a toolset is admin-only (it is org-wide config). Access is not set
 * up here: a toolset names an integration, and the connection is authorized by
 * the calling user's own token for that integration. Discovery therefore needs
 * the admin doing it to have connected that integration themselves.
 *
 * Listing is open to any signed-in user, so the Edit-agent toolset checklist can
 * offer them as grants. No secrets cross this API — the tokens live in the
 * integration credential store.
 *
 * Mounted at `/api/toolsets`, so the paths here are relative — that keeps the
 * type (`ToolsetRoutes`) clean for the Hono RPC client. The handlers are chained
 * (RPC infers the client from the chain) and validated with `zValidator`. The
 * fixed routes (`/kinds`, `/kind-tools`, `/discover`) come before `/:name` so
 * the param cannot capture them.
 */
export const toolsetRoutes = new Hono<SessionEnv>()
  .get("/", (context) => context.json({ servers: getToolsetStore().list() }))
  /** The registered toolset kinds (built-in + plugin), for the "add toolset" UI. */
  .get("/kinds", (context) => context.json({ kinds: toolsetKinds() }))
  /**
   * The tools a plugin kind would expose for a draft toolset, so the admin can
   * enable a subset (the "install 2 of 5" picker). Admin-only, no network — it
   * runs the kind's own resolve to read tool metadata.
   */
  .post(
    "/kind-tools",
    zValidator(
      "json",
      z.object({
        kind: z.string(),
        url: z.string().optional(),
        integration: z.string().optional(),
      }),
    ),
    (context) => {
      const caller = context.get("caller")
      if (caller.role !== "admin") return context.json({ error: "admin_required" }, 403)
      const raw = context.req.valid("json")
      if (!raw.kind || !getToolsetType(raw.kind)) {
        return context.json({ error: "unknown_kind", kind: raw.kind }, 400)
      }
      const now = new Date().toISOString()
      const draft = Toolset.parse({
        name: "draft",
        label: "draft",
        kind: raw.kind,
        url: raw.url || undefined,
        integration: raw.integration ?? "",
        createdAt: now,
        updatedAt: now,
      })
      const base = { tenantId: caller.tenantId, agent: "", session: "config" }
      return context.json({ tools: listToolsetTools(raw.kind, draft, base) })
    },
  )
  /**
   * Connect to a candidate server with the admin's own integration token and list
   * its tools, so they can pick which to enable. Nothing is saved.
   */
  .post("/discover", zValidator("json", McpDiscoveryInput), async (context) => {
    if (context.get("caller").role !== "admin")
      return context.json({ error: "admin_required" }, 403)
    const body = context.req.valid("json")

    let bearer: string | undefined
    try {
      bearer = await integrationBearer(body.integration, context.get("caller").tenantId)
    } catch (caught) {
      // The token exists but could not be turned into a bearer (e.g. a Google
      // refresh that failed) — a connection problem, not a missing connection.
      return context.json({ error: "integration_auth_failed", message: messageOf(caught) }, 502)
    }
    if (!bearer) {
      // The admin must connect their own account for this integration first.
      return context.json({ error: "integration_not_connected" }, 409)
    }
    try {
      const tools = await discoverMcpTools({ url: body.url, transport: body.transport }, bearer)
      return context.json({ tools })
    } catch (caught) {
      return context.json({ error: "discovery_failed", message: messageOf(caught) }, 502)
    }
  })
  .put(
    "/:name",
    zValidator("param", z.object({ name: z.string() })),
    zValidator("json", ToolsetInput.omit({ name: true })),
    (context) => {
      if (context.get("caller").role !== "admin") {
        return context.json({ error: "admin_required" }, 403)
      }
      const parsed = { ...context.req.valid("json"), name: context.req.valid("param").name }
      // The protocol bounds the kind's shape; the registry is the authority on
      // which kinds exist (built-ins + any a plugin registered). Reject unknown.
      const type = getToolsetType(parsed.kind)
      if (!type) {
        return context.json({ error: "unknown_kind", kind: parsed.kind }, 400)
      }
      // A kind that authenticates/mounts through an integration must name one; a
      // kind that does not (a self-authenticating plugin kind) may leave it empty.
      if (type.usesIntegration && !parsed.integration) {
        return context.json({ error: "integration_required", kind: parsed.kind }, 400)
      }
      return context.json({ server: getToolsetStore().put(parsed) })
    },
  )
  .delete("/:name", zValidator("param", z.object({ name: z.string() })), (context) => {
    if (context.get("caller").role !== "admin")
      return context.json({ error: "admin_required" }, 403)
    return context.json({ removed: getToolsetStore().remove(context.req.valid("param").name) })
  })

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "unknown"
}

/** The router's type, for the Hono RPC client (`hc<ToolsetRoutes>`). */
export type ToolsetRoutes = typeof toolsetRoutes
