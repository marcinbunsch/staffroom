import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { getWidgetsStore } from "../coordinator/widgets.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Widgets over HTTP: the operator reads its widgets (all, or one agent's, for a
 * board or a dashboard picker) and deletes its own. Writes come from the agent
 * tool, not the API — like artifacts, a widget is produced by an agent, and the
 * operator curates and removes.
 *
 * Mounted at `/api/widgets`; paths are relative so the type stays clean for the
 * Hono RPC client. Everything is tenant-scoped by the store.
 */
const idParam = z.object({ id: z.string().min(1) })

export const widgetRoutes = new Hono<SessionEnv>()
  .get("/", zValidator("query", z.object({ agent: z.string().optional() })), (context) => {
    const { tenantId } = context.get("caller")
    const { agent } = context.req.valid("query")
    const widgets = agent
      ? getWidgetsStore().listForAgent(tenantId, agent)
      : getWidgetsStore().list(tenantId)
    return context.json({ widgets })
  })
  .get("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    const widget = getWidgetsStore().get(tenantId, context.req.valid("param").id)
    if (!widget) return context.json({ error: "unknown_widget" }, 404)
    return context.json({ widget })
  })
  .delete("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    if (!getWidgetsStore().remove(tenantId, context.req.valid("param").id)) {
      return context.json({ error: "unknown_widget" }, 404)
    }
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<WidgetRoutes>`). */
export type WidgetRoutes = typeof widgetRoutes
