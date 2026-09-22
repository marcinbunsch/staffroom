import type { ToolRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** The tool catalog and its org/user credentials — on the typed Hono RPC client. */
export function toolsDomain(ctx: DomainContext) {
  const rpc = hc<ToolRoutes>(`${ctx.base}/api/tools`, ctx.hcInit)
  return {
    catalog: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).tools
    },
    credentials: async () => {
      const res = await rpc.credentials.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).credentials
    },
    putCredential: async (input: { scope: "org" | "user"; tool: string; secret: string }) => {
      const res = await rpc.credentials.$put({ json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    removeCredential: async (id: string) => {
      const res = await rpc.credentials[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
