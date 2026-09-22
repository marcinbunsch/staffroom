import type { TeamRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** Teams — the tool-grant authorization layer (admin-only), plus the caller's own grants. */
export function teamsDomain(ctx: DomainContext) {
  const rpc = hc<TeamRoutes>(`${ctx.base}/api/teams`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).teams
    },
    myGrants: async () => {
      const res = await rpc.grants.me.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).toolsets
    },
    create: async (name: string) => {
      const res = await rpc.index.$post({ json: { name } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    rename: async (id: string, name: string) => {
      const res = await rpc[":id"].$patch({ param: { id }, json: { name } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    setMembers: async (id: string, userIds: string[]) => {
      const res = await rpc[":id"].members.$put({ param: { id }, json: { userIds } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    setGrants: async (id: string, toolsets: string[]) => {
      const res = await rpc[":id"].grants.$put({ param: { id }, json: { toolsets } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    setIntegrationGrants: async (id: string, integrations: string[]) => {
      const res = await rpc[":id"]["integration-grants"].$put({
        param: { id },
        json: { integrations },
      })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
  }
}
