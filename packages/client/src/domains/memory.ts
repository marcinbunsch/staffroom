import type { MemoryRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"
import type { NewAgentMemoryEntry } from "../types.ts"

/** An agent's memory archive (operator view) — on the typed Hono RPC client. */
export function memoryDomain(ctx: DomainContext) {
  const rpc = hc<MemoryRoutes>(`${ctx.base}/api/memory`, ctx.hcInit)
  return {
    list: async (agent: string) => {
      const res = await rpc.for[":agent"].$get({ param: { agent } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).entries
    },
    update: async (agent: string, input: NewAgentMemoryEntry) => {
      const res = await rpc.for[":agent"].$post({ param: { agent }, json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    forget: async (agent: string, id: string) => {
      const res = await rpc.for[":agent"][":id"].$delete({ param: { agent, id } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
