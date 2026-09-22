import type { WidgetRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/**
 * Widgets — on the typed Hono RPC client. Read the tenant's widgets (all, or one
 * agent's for a board) and delete one; writes come from the agent tool, not here.
 */
export function widgetsDomain(ctx: DomainContext) {
  const rpc = hc<WidgetRoutes>(`${ctx.base}/api/widgets`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get({ query: {} })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).widgets
    },
    listForAgent: async (agent: string) => {
      const res = await rpc.index.$get({ query: { agent } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).widgets
    },
    get: async (id: string) => {
      const res = await rpc[":id"].$get({ param: { id } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).widget
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
