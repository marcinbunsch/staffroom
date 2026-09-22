import type { McpTransport } from "@staffroom/protocol"
import type { ToolsetRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"
import type { ToolsetInputBody } from "../types.ts"

/** Toolsets — the configured MCP/sandbox/plugin toolsets, their kinds, and discovery, on the typed Hono RPC client. */
export function toolsetsDomain(ctx: DomainContext) {
  const rpc = hc<ToolsetRoutes>(`${ctx.base}/api/toolsets`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).servers
    },
    kinds: async () => {
      const res = await rpc.kinds.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).kinds
    },
    kindTools: async (input: { kind: string; url?: string; integration?: string }) => {
      const res = await rpc["kind-tools"].$post({ json: input })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).tools
    },
    discover: async (input: { url: string; transport: string; integration: string }) => {
      const res = await rpc.discover.$post({
        json: { ...input, transport: input.transport as McpTransport },
      })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).tools
    },
    put: async (name: string, input: ToolsetInputBody) => {
      const res = await rpc[":name"].$put({
        param: { name },
        json: { ...input, transport: input.transport as McpTransport | undefined },
      })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).server
    },
    remove: async (name: string) => {
      const res = await rpc[":name"].$delete({ param: { name } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
