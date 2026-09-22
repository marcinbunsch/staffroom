import type { AttentionRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** The attention board — pending approvals and items, and the operator's answers. */
export function attentionDomain(ctx: DomainContext) {
  const rpc = hc<AttentionRoutes>(`${ctx.base}/api/attention`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).items
    },
    answerApproval: async (id: string, decision: "approved" | "denied", reason?: string) => {
      const res = await rpc.approvals[":id"].$post({ param: { id }, json: { decision, reason } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    resolve: async (id: string, note?: string) => {
      const res = await rpc.items[":id"].resolve.$post({ param: { id }, json: { note } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    dismiss: async (id: string, note: string) => {
      const res = await rpc.items[":id"].dismiss.$post({ param: { id }, json: { note } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
  }
}
