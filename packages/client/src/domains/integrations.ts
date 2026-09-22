import type { IntegrationRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"
import type { IntegrationInputBody } from "../types.ts"

/**
 * Integrations — the provider instances and the per-user connect flow, on the
 * typed Hono RPC client. The methods hide the hc envelope (param/json/query,
 * res.ok narrowing) behind plain calls.
 */
export function integrationsDomain(ctx: DomainContext) {
  const rpc = hc<IntegrationRoutes>(`${ctx.base}/api/integrations`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).integrations
    },
    types: async () => {
      const res = await rpc.types.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).types
    },
    create: async (input: IntegrationInputBody) => {
      const res = await rpc.index.$post({ json: input })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).integration
    },
    update: async (name: string, input: IntegrationInputBody) => {
      const res = await rpc[":name"].$put({ param: { name }, json: input })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).integration
    },
    remove: async (name: string) => {
      const res = await rpc[":name"].$delete({ param: { name } })
      if (!res.ok) throw await apiError(res)
    },
    // The Docker sandbox runtime: daemon/image presence, and the server-side
    // image build the settings card offers when the image is missing.
    sandboxStatus: async () => {
      const res = await rpc.sandbox.status.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).status
    },
    buildSandboxImage: async () => {
      const res = await rpc.sandbox.build.$post()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).build
    },
    // Per-user connect: the server builds the consent URL against our own origin
    // (so the redirect matches); the caller sends the browser there.
    connect: async (name: string) => {
      const res = await rpc[":name"].connect.$get({
        param: { name },
        query: { origin: ctx.origin },
      })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    disconnect: async (name: string) => {
      const res = await rpc[":name"].connection.$delete({ param: { name } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
