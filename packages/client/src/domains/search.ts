import type { SearchRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** Keyword search over readable files (FTS5) — on the typed Hono RPC client. */
export function searchDomain(ctx: DomainContext) {
  const rpc = hc<SearchRoutes>(`${ctx.base}/api/search`, ctx.hcInit)
  return {
    query: async (q: string) => {
      const res = await rpc.index.$get({ query: { q } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).hits
    },
  }
}
