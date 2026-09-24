import { z } from "zod"
import { AgentId } from "./identity.ts"

/**
 * A conversation an agent has — a chat.
 *
 * An agent always has exactly one open **main** chat (the durable thread) plus
 * any number of **side** chats. A chat is a conversation, not a different agent:
 * side chats get the same prompt, memory and tools. Closing a chat only removes
 * it from the tab strip — the conversation stays in Flue's store and in history.
 *
 * The `session` (the Flue conversation id) is **stored, not computed**, so the
 * naming rule lives in one place (`ChatStore`) and can change without a
 * migration. The first main chat keeps the bare `tenant:agent` session, so every
 * conversation that existed before this table stays exactly where it was.
 */

export const ChatKind = z.enum(["main", "side"])
export type ChatKind = z.infer<typeof ChatKind>

export const CHAT_TITLE_MAX = 60
export const CHAT_HISTORY_PAGE = 20
export const INBOX_PAGE = 50
/** How much of an agent's last reply the inbox keeps as a preview. */
export const CHAT_PREVIEW_MAX = 200
export const NEW_CHAT_TITLE = "New chat"
export const MAIN_TITLE = "Main"

export const Chat = z.object({
  id: z.number().int().positive(),
  tenantId: z.string().min(1),
  agent: AgentId,
  /** The Flue conversation id: `alice:pm`, `alice:pm__c2`, `alice:pm__t7`. */
  session: z.string().min(1),
  title: z.string().min(1),
  kind: ChatKind,
  /** ISO timestamp when the chat was closed, or null while open. */
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  /** ISO of the last message, or null until something is said; orders history. */
  lastMessageAt: z.string().nullable(),
  /** A plain-text excerpt of the agent's last reply, or null before one. */
  lastPreview: z.string().nullable(),
})
export type Chat = z.infer<typeof Chat>

/** A chat plus the live per-chat state the tab strip needs. */
export const TabChat = Chat.extend({
  unread: z.number().int().nonnegative(),
  active: z.boolean(),
})
export type TabChat = z.infer<typeof TabChat>

/** The tab strip: open chats (main first) plus how many closed ones are in history. */
export const ChatList = z.object({
  chats: z.array(TabChat),
  historyCount: z.number().int().nonnegative(),
})
export type ChatList = z.infer<typeof ChatList>

/**
 * A page of the inbox: every open chat across the tenant's agents that has had
 * a reply, unread first, then by latest reply. Each carries the same live state
 * as a tab.
 */
export const InboxPage = z.object({
  chats: z.array(TabChat),
  total: z.number().int().nonnegative(),
})
export type InboxPage = z.infer<typeof InboxPage>

/** A page of history: every chat except the live main. */
export const ChatHistoryPage = z.object({
  chats: z.array(Chat),
  total: z.number().int().nonnegative(),
})
export type ChatHistoryPage = z.infer<typeof ChatHistoryPage>

export const ChatOpenInput = z.object({
  title: z.string().min(1).max(CHAT_TITLE_MAX).optional(),
})
export type ChatOpenInput = z.infer<typeof ChatOpenInput>

export const ChatRenameInput = z.object({
  title: z.string().min(1).max(CHAT_TITLE_MAX),
})
export type ChatRenameInput = z.infer<typeof ChatRenameInput>

/**
 * A chat title from its first message — the first line, trimmed to the cap.
 * Deliberately a substring, not a model call: that would be a turn per chat for
 * something a substring gets right nearly always.
 */
export function titleFromMessage(message: string): string {
  const line = message.trim().split("\n", 1)[0]?.trim() ?? ""
  if (!line) return NEW_CHAT_TITLE
  return line.length > CHAT_TITLE_MAX ? `${line.slice(0, CHAT_TITLE_MAX - 1).trimEnd()}…` : line
}

/**
 * A reply's inbox preview: the Markdown's punctuation dropped (a preview is read
 * as plain text), whitespace collapsed to single spaces, capped. A light strip,
 * not a parser — it only needs to read well in one line. Null when the reply had
 * no text at all (a turn of only tool calls), so the caller can keep the
 * previous preview rather than blank it.
 */
export function previewFromText(text: string): string | null {
  const flat = text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!flat) return null
  return flat.length > CHAT_PREVIEW_MAX ? `${flat.slice(0, CHAT_PREVIEW_MAX - 1).trimEnd()}…` : flat
}
