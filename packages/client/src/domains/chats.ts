import type { ChatRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** Chats — a member's conversations (tabs, history, lifecycle), on the typed Hono RPC client. */
export function chatsDomain(ctx: DomainContext) {
  const rpc = hc<ChatRoutes>(`${ctx.base}/api/chats`, ctx.hcInit)
  return {
    list: async (agent: string) => {
      const res = await rpc.for[":agent"].$get({ param: { agent } })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    search: async (q: string) => {
      const res = await rpc.search.$get({ query: { q } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).chats
    },
    history: async (agent: string, limit: number, offset: number) => {
      const res = await rpc.for[":agent"].history.$get({
        param: { agent },
        query: { limit: String(limit), offset: String(offset) },
      })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    open: async (agent: string, title?: string) => {
      const res = await rpc.for[":agent"].$post({ param: { agent }, json: title ? { title } : {} })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).chat
    },
    clearMain: async (agent: string) => {
      const res = await rpc.for[":agent"].clear.$post({ param: { agent } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).chat
    },
    rename: async (chatId: number, title: string) => {
      const res = await rpc[":chatId"].$patch({
        param: { chatId: String(chatId) },
        json: { title },
      })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).chat
    },
    close: async (chatId: number) => {
      const res = await rpc[":chatId"].close.$post({ param: { chatId: String(chatId) } })
      if (!res.ok) throw await apiError(res)
    },
    reopen: async (chatId: number) => {
      const res = await rpc[":chatId"].reopen.$post({ param: { chatId: String(chatId) } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).chat
    },
    remove: async (chatId: number) => {
      const res = await rpc[":chatId"].$delete({ param: { chatId: String(chatId) } })
      if (!res.ok) throw await apiError(res)
    },
    markRead: async (chatId: number) => {
      const res = await rpc[":chatId"].read.$post({ param: { chatId: String(chatId) } })
      if (!res.ok) throw await apiError(res)
    },
  }
}
