import type { MeRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** Session identity — who the caller is (tenant + role), for `api.me()`. */
export function sessionDomain(ctx: DomainContext) {
  const rpc = hc<MeRoutes>(`${ctx.base}/api/me`, ctx.hcInit)
  return {
    me: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
  }
}
