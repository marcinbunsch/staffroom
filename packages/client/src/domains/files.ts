import type { FileRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/**
 * Files — on the typed Hono RPC client. The methods hide the hc envelope
 * (param/json/form, res.ok narrowing) behind plain calls; `upload` is a typed
 * multipart form.
 */
export function filesDomain(ctx: DomainContext) {
  const rpc = hc<FileRoutes>(`${ctx.base}/api/files`, ctx.hcInit)
  return {
    list: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).files
    },
    /**
     * One filtered, sorted page of the shared space — `{ files, total, labels }`.
     * The server does the filtering and sorting, so the Files page can page
     * across the whole matching set rather than the current unpaged slice.
     */
    page: async (opts: {
      limit: number
      offset: number
      filter?: "all" | "operator" | "artifacts" | "org"
      agent?: string
      label?: string
      q?: string
      sort?: "recent" | "name"
    }) => {
      const res = await rpc.page.$get({
        query: {
          limit: String(opts.limit),
          offset: String(opts.offset),
          ...(opts.filter ? { filter: opts.filter } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
          ...(opts.label ? { label: opts.label } : {}),
          ...(opts.q ? { q: opts.q } : {}),
          ...(opts.sort ? { sort: opts.sort } : {}),
        },
      })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    upload: async (file: File, opts: { agent?: string; name?: string; labels?: string[] } = {}) => {
      const res = await rpc.index.$post({
        form: {
          file,
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.agent ? { agent: opts.agent } : {}),
          // The route takes labels as a JSON-array string in the multipart form.
          ...(opts.labels?.length ? { labels: JSON.stringify(opts.labels) } : {}),
        },
      })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    setVisibility: async (id: string, visibility: "private" | "org") => {
      const res = await rpc[":id"].visibility.$post({ param: { id }, json: { visibility } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    setLabels: async (id: string, labels: string[]) => {
      const res = await rpc[":id"].labels.$post({ param: { id }, json: { labels } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    remove: async (id: string) => {
      const res = await rpc[":id"].$delete({ param: { id } })
      if (!res.ok) throw await apiError(res)
    },
    /** One file's metadata by id — for a standalone view that has only the id. */
    get: async (id: string) => {
      const res = await rpc[":id"].$get({ param: { id } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).file
    },
    /** A URL for the raw bytes — used as an `<a>` href / for `window.open`. */
    contentUrl: (id: string) => `${ctx.base}/api/files/${id}/content`,
    text: async (id: string) => {
      const res = await rpc[":id"].content.$get({ param: { id } })
      if (!res.ok) return Promise.reject(res)
      return res.text()
    },
  }
}
