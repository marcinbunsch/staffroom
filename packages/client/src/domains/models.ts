import type { ModelCredentialRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { ApiError, type DomainContext, apiError } from "../http.ts"

/**
 * Model credentials — org/personal keys, local endpoints, and the codex import.
 * On the typed Hono RPC client; the methods hide the hc envelope behind plain
 * calls. `remove` stays on the raw fetch for its 409 special case.
 */
export function modelsDomain(ctx: DomainContext) {
  const rpc = hc<ModelCredentialRoutes>(`${ctx.base}/api/model-credentials`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).credentials
    },
    upstreams: async () => {
      const res = await rpc.upstreams.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).upstreams
    },
    addApiKey: async (input: {
      scope: "org" | "user"
      upstream: string
      label: string
      apiKey: string
      isDefault?: boolean
    }) => {
      const res = await rpc.index.$post({ json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    addLocal: async (input: {
      scope: "org" | "user"
      upstream: string
      label: string
      baseUrl: string
      apiKey?: string
      isDefault?: boolean
    }) => {
      const res = await rpc.index.$post({ json: { kind: "local", ...input } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    /** The models a credential can run (Codex slugs, a local server's loaded models, else []). */
    models: async (id: string) => {
      const res = await rpc[":id"].models.$get({ param: { id } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).models
    },
    /** Make a credential the org-wide default, with the model agents fall back to. */
    setDefault: async (id: string, model: string) => {
      const res = await rpc[":id"].default.$post({ param: { id }, json: { model } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).credential
    },
    importCodex: async (input: {
      contents: string
      scope: "org" | "user"
      label: string
      isDefault?: boolean
    }) => {
      const res = await rpc.codex.$post({ json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    /** Live Codex usage for the composer gauge; null when there's no login or it's unreachable. */
    codexUsage: async () => {
      const res = await rpc.codex.usage.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).usage
    },
    rename: async (id: string, label: string) => {
      const res = await rpc[":id"].$patch({ param: { id }, json: { label } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (res.ok) return
      const body = (await res.json().catch(() => ({}))) as { error?: string; agents?: string[] }
      // A credential still used by an agent is refused, not cascaded — name the
      // agents so the operator can repoint them first.
      if (res.status === 409 && body.error === "credential_in_use") {
        throw new Error(
          `Still used by: ${(body.agents ?? []).join(", ")}. Point those agents at another credential first.`,
        )
      }
      throw new ApiError(res.status, body.error ?? res.statusText)
    },
  }
}
