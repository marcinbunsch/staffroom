import type { JobRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** Jobs — the board, a job's detail, and operator actions on one, on the typed Hono RPC client. */
export function jobsDomain(ctx: DomainContext) {
  const rpc = hc<JobRoutes>(`${ctx.base}/api/jobs`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).jobs
    },
    get: async (id: number) => {
      const res = await rpc[":id"].$get({ param: { id: String(id) } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).job
    },
    action: async (id: number, action: string, body?: unknown) => {
      const res = await rpc[":id"][":action"].$post({
        param: { id: String(id), action },
        json: (body ?? {}) as { message?: string },
      })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
  }
}
