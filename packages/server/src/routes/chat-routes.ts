import { zValidator } from "@hono/zod-validator"
import { CHAT_HISTORY_PAGE } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { getActivityTracker } from "../coordinator/activity.ts"
import { MainChatError, getChatStore } from "../coordinator/chats.ts"
import { getOperatorEvents } from "../coordinator/operator-events.ts"
import { getUnreadStore } from "../coordinator/unread.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Chats — a member's conversations. Per-agent routes (list/history/open/clear)
 * are keyed on the `:agent` id under `/for`; per-chat routes (rename/close/
 * reopen/delete/read) on the numeric `:chatId`. Everything is tenant-scoped to
 * the caller; a chat that belongs to another tenant simply is not found.
 *
 * Mounted at `/api/chats`, so the paths here are relative — that keeps the type
 * (`ChatRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator`. The
 * `/for/...` routes come first so the static "for" segment isn't captured by
 * the `:chatId` param.
 */
const agentParam = z.object({ agent: z.string() })
const chatIdParam = z.object({ chatId: z.string() })

export const chatRoutes = new Hono<SessionEnv>()
  /** The tab strip: open chats with live unread + activity, and the history count. */
  .get("/for/:agent", zValidator("param", agentParam), (context) => {
    const { tenantId } = context.get("caller")
    const agent = context.req.valid("param").agent
    const store = getChatStore()
    const unread = getUnreadStore().sessions(tenantId, agent)
    const active = new Set(getActivityTracker().sessions(tenantId, agent))
    const chats = store.list(tenantId, agent).map((chat) => ({
      ...chat,
      unread: unread[chat.session] ?? 0,
      active: active.has(chat.session),
    }))
    return context.json({ chats, historyCount: store.historyCount(tenantId, agent) })
  })
  /** Paginated history: every chat except the live main. */
  .get(
    "/for/:agent/history",
    zValidator("param", agentParam),
    zValidator("query", z.object({ limit: z.string().optional(), offset: z.string().optional() })),
    (context) => {
      const { tenantId } = context.get("caller")
      const agent = context.req.valid("param").agent
      const limit = Math.min(Number(context.req.query("limit")) || CHAT_HISTORY_PAGE, 100)
      const offset = Math.max(Number(context.req.query("offset")) || 0, 0)
      return context.json(getChatStore().history(tenantId, agent, { limit, offset }))
    },
  )
  /** Search open chats by title across the tenant — the command palette's chat jump. */
  .get("/search", zValidator("query", z.object({ q: z.string() })), (context) => {
    const { tenantId } = context.get("caller")
    const chats = getChatStore().searchByTitle(tenantId, context.req.valid("query").q)
    return context.json({ chats })
  })
  /** Open a new side chat. */
  .post(
    "/for/:agent",
    zValidator("param", agentParam),
    zValidator("json", z.object({ title: z.string().optional() })),
    (context) => {
      const { tenantId } = context.get("caller")
      const agent = context.req.valid("param").agent
      const title = context.req.valid("json").title
      return context.json({ chat: getChatStore().openSide(tenantId, agent, title) })
    },
  )
  /** Start over: close the current main and open a fresh one. */
  .post("/for/:agent/clear", zValidator("param", agentParam), (context) => {
    const { tenantId } = context.get("caller")
    const agent = context.req.valid("param").agent
    return context.json({ chat: getChatStore().clearMain(tenantId, agent) })
  })
  .patch(
    "/:chatId",
    zValidator("param", chatIdParam),
    zValidator("json", z.object({ title: z.string() })),
    (context) => {
      const { tenantId } = context.get("caller")
      const id = Number(context.req.valid("param").chatId)
      const chat = getChatStore().rename(tenantId, id, context.req.valid("json").title)
      if (!chat) return context.json({ error: "unknown_chat" }, 404)
      return context.json({ chat })
    },
  )
  .post("/:chatId/close", zValidator("param", chatIdParam), (context) => {
    const { tenantId } = context.get("caller")
    const id = Number(context.req.valid("param").chatId)
    try {
      const chat = getChatStore().close(tenantId, id)
      if (!chat) return context.json({ error: "unknown_chat" }, 404)
      return context.json({ chat })
    } catch (caught) {
      if (caught instanceof MainChatError) return context.json({ error: "main_chat" }, 409)
      throw caught
    }
  })
  .post("/:chatId/reopen", zValidator("param", chatIdParam), (context) => {
    const { tenantId } = context.get("caller")
    const id = Number(context.req.valid("param").chatId)
    const chat = getChatStore().reopen(tenantId, id)
    if (!chat) return context.json({ error: "unknown_chat" }, 404)
    return context.json({ chat })
  })
  .delete("/:chatId", zValidator("param", chatIdParam), (context) => {
    const { tenantId } = context.get("caller")
    const id = Number(context.req.valid("param").chatId)
    try {
      const chat = getChatStore().delete(tenantId, id)
      if (!chat) return context.json({ error: "unknown_chat" }, 404)
      getUnreadStore().markRead(chat.session)
      return context.json({ removed: true })
    } catch (caught) {
      if (caught instanceof MainChatError) return context.json({ error: "main_chat" }, 409)
      throw caught
    }
  })
  /** The operator opened this chat — clear its unread count. */
  .post("/:chatId/read", zValidator("param", chatIdParam), (context) => {
    const { tenantId } = context.get("caller")
    const id = Number(context.req.valid("param").chatId)
    const chat = getChatStore().get(tenantId, id)
    if (!chat) return context.json({ error: "unknown_chat" }, 404)
    getUnreadStore().markRead(chat.session)
    getOperatorEvents().publish({
      tenantId,
      event: { type: "agent.unread.changed", agent: chat.agent },
    })
    return context.json({ ok: true })
  })

/** The router's type, for the Hono RPC client (`hc<ChatRoutes>`). */
export type ChatRoutes = typeof chatRoutes
