import type { SpendRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"
import type { SpendDimension } from "../types.ts"

/** Spend — the priced audit, grouped by a dimension, plus the admin roll-up. */
export function spendDomain(ctx: DomainContext) {
  const rpc = hc<SpendRoutes>(`${ctx.base}/api/spend`, ctx.hcInit)
  return {
    get: async (dimension: SpendDimension) => {
      const res = await rpc.index.$get({ query: { dimension } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    admin: async () => {
      const res = await rpc.admin.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).rows
    },
  }
}
