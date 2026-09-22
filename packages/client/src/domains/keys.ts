import type { KeyRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/**
 * Personal API keys for non-browser clients (the CLI). `create` returns the
 * plaintext key once — it is never retrievable again; `list` shows only
 * metadata. Types are inferred from the better-auth apiKey plugin's shapes.
 */
export function keysDomain(ctx: DomainContext) {
  const rpc = hc<KeyRoutes>(`${ctx.base}/api/keys`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).keys
    },
    create: async (name: string) => {
      const res = await rpc.index.$post({ json: { name } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).key
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
