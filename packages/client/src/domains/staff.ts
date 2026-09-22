import type { StaffRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"
import type { NewStaff } from "../types.ts"

/** Staff members (agents) — the roster, its live overview, and edits. */
export function staffDomain(ctx: DomainContext) {
  const rpc = hc<StaffRoutes>(`${ctx.base}/api/staff`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).staff
    },
    overview: async () => {
      const res = await rpc.overview.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).agents
    },
    create: async (input: NewStaff) => {
      const res = await rpc.index.$post({ json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    update: async (id: string, patch: Partial<NewStaff> & { enabled?: boolean }) => {
      const res = await rpc[":id"].$patch({ param: { id }, json: patch })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
