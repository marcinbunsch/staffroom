import { zValidator } from "@hono/zod-validator"
import { DashboardItemLayout } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { getDashboardsStore } from "../coordinator/dashboards.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Dashboards over HTTP: the operator lists, creates, renames and deletes
 * dashboards, and places / moves / removes widgets on them. Everything is
 * tenant-scoped by the store, and a placement is refused unless the tenant owns
 * both the dashboard and the widget.
 *
 * Mounted at `/api/dashboards`; relative paths keep the type clean for RPC.
 */
const idParam = z.object({ id: z.string().min(1) })
const box = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
})

export const dashboardRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ dashboards: getDashboardsStore().list(tenantId) })
  })
  .post("/", zValidator("json", z.object({ name: z.string().min(1).max(200) })), (context) => {
    const { tenantId } = context.get("caller")
    const dashboard = getDashboardsStore().create(tenantId, context.req.valid("json").name)
    return context.json({ dashboard }, 201)
  })
  .get("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    const detail = getDashboardsStore().detail(tenantId, context.req.valid("param").id)
    if (!detail) return context.json({ error: "unknown_dashboard" }, 404)
    return context.json(detail)
  })
  .patch(
    "/:id",
    zValidator("param", idParam),
    zValidator("json", z.object({ name: z.string().min(1).max(200) })),
    (context) => {
      const { tenantId } = context.get("caller")
      const dashboard = getDashboardsStore().rename(
        tenantId,
        context.req.valid("param").id,
        context.req.valid("json").name,
      )
      if (!dashboard) return context.json({ error: "unknown_dashboard" }, 404)
      return context.json({ dashboard })
    },
  )
  .delete("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    if (!getDashboardsStore().remove(tenantId, context.req.valid("param").id)) {
      return context.json({ error: "unknown_dashboard" }, 404)
    }
    return context.json({ removed: true })
  })
  .post(
    "/:id/items",
    zValidator("param", idParam),
    zValidator("json", box.extend({ widgetId: z.string().min(1) })),
    (context) => {
      const { tenantId } = context.get("caller")
      const { widgetId, x, y, w, h } = context.req.valid("json")
      const item = getDashboardsStore().addItem(tenantId, context.req.valid("param").id, widgetId, {
        x,
        y,
        w,
        h,
      })
      // Undefined means the tenant does not own the dashboard or the widget.
      if (!item) return context.json({ error: "unknown_dashboard_or_widget" }, 404)
      return context.json({ item }, 201)
    },
  )
  .delete(
    "/:id/items/:itemId",
    zValidator("param", z.object({ id: z.string().min(1), itemId: z.string().min(1) })),
    (context) => {
      const { tenantId } = context.get("caller")
      const { id, itemId } = context.req.valid("param")
      if (!getDashboardsStore().removeItem(tenantId, id, itemId)) {
        return context.json({ error: "unknown_item" }, 404)
      }
      return context.json({ removed: true })
    },
  )
  .put(
    "/:id/layout",
    zValidator("param", idParam),
    zValidator("json", z.object({ items: z.array(DashboardItemLayout) })),
    (context) => {
      const { tenantId } = context.get("caller")
      if (
        !getDashboardsStore().setLayout(
          tenantId,
          context.req.valid("param").id,
          context.req.valid("json").items,
        )
      ) {
        return context.json({ error: "unknown_dashboard" }, 404)
      }
      return context.json({ saved: true })
    },
  )

/** The router's type, for the Hono RPC client (`hc<DashboardRoutes>`). */
export type DashboardRoutes = typeof dashboardRoutes
