import type { DashboardItemLayout } from "@staffroom/protocol"
import type { DashboardRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/**
 * Dashboards — on the typed Hono RPC client. List/create/rename/delete a
 * dashboard, and place / move / remove widgets on it. A placement references a
 * live widget, so `detail` returns each item resolved with its current widget.
 */
export function dashboardsDomain(ctx: DomainContext) {
  const rpc = hc<DashboardRoutes>(`${ctx.base}/api/dashboards`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).dashboards
    },
    create: async (name: string) => {
      const res = await rpc.index.$post({ json: { name } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).dashboard
    },
    detail: async (id: string) => {
      const res = await rpc[":id"].$get({ param: { id } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    rename: async (id: string, name: string) => {
      const res = await rpc[":id"].$patch({ param: { id }, json: { name } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).dashboard
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
    },
    addItem: async (
      id: string,
      placement: { widgetId: string; x: number; y: number; w: number; h: number },
    ) => {
      const res = await rpc[":id"].items.$post({ param: { id }, json: placement })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).item
    },
    removeItem: async (id: string, itemId: string) => {
      const res = await rpc[":id"].items[":itemId"].$delete({ param: { id, itemId } })
      if (!res.ok) throw await apiError(res)
    },
    saveLayout: async (id: string, items: DashboardItemLayout[]) => {
      const res = await rpc[":id"].layout.$put({ param: { id }, json: { items } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
