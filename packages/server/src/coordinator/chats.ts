import { randomUUID } from "node:crypto"
import { Chat, type ChatKind, MAIN_TITLE, NEW_CHAT_TITLE } from "@staffroom/protocol"
import { type Selectable, type SqlBool, sql } from "kysely"
import { type Database, getDatabase } from "./database.ts"
import type { ChatTable } from "./schema.ts"

/** Thrown when an operation would break the one-open-main-chat invariant. */
export class MainChatError extends Error {}

/**
 * The chats an agent has — its conversations.
 *
 * Enforces one invariant above all: **an agent always has exactly one open main
 * chat.** `main()` lazy-creates it; `close`/`delete` refuse the live main;
 * `clearMain` closes-then-opens; `reopen` demotes a reopened main to a side
 * chat so it can never become a second open main.
 *
 * Tenant-scoped like every store: the tenant is the first argument of every
 * per-agent method, because a missing tenant predicate is easiest to catch when
 * the parameter that should feed it is right there in the signature.
 */
export class ChatStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** The open main chat, created on first access if the agent has none. */
  main(tenantId: string, agent: string): Chat {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("chats")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("agent", "=", agent)
        .where("kind", "=", "main")
        .where("closed_at", "is", null),
    )
    return row ? toChat(row) : this.#insert(tenantId, agent, "main", MAIN_TITLE, null)
  }

  /** The tab strip: open chats, main first. Ensures a main exists. */
  list(tenantId: string, agent: string): Chat[] {
    this.main(tenantId, agent)
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("chats")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("agent", "=", agent)
          .where("closed_at", "is", null)
          .orderBy((eb) => eb.case().when("kind", "=", "main").then(0).else(1).end(), "asc")
          .orderBy("id", "asc"),
      )
      .map(toChat)
  }

  /** History: everything but the live main chat, most-recent first. */
  history(
    tenantId: string,
    agent: string,
    { limit, offset }: { limit: number; offset: number },
  ): { chats: Chat[]; total: number } {
    const chats = this.#db
      .all(
        this.#historyQuery(tenantId, agent)
          .selectAll()
          .orderBy((eb) => eb.fn.coalesce("last_message_at", "created_at"), "desc")
          .orderBy("id", "desc")
          .limit(limit)
          .offset(offset),
      )
      .map(toChat)
    return { chats, total: this.historyCount(tenantId, agent) }
  }

  historyCount(tenantId: string, agent: string): number {
    const row = this.#db.get<{ total: number }>(
      this.#historyQuery(tenantId, agent).select((eb) => eb.fn.countAll<number>().as("total")),
    )
    return row ? Number(row.total) : 0
  }

  get(tenantId: string, id: number): Chat | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("chats")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return row ? toChat(row) : undefined
  }

  /**
   * Open chats across all of a tenant's agents whose title matches, most-recent
   * first — the query behind the command palette's chat search, so a chat can be
   * found and jumped to without having opened its agent first. Closed chats
   * (history) are left out; they live under `history`, not the tab strip. LIKE
   * wildcards in the query are escaped so a literal `%` matches a percent sign
   * rather than everything.
   */
  searchByTitle(tenantId: string, query: string, limit = 20): Chat[] {
    const term = query.trim()
    if (!term) return []
    const pattern = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("chats")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("closed_at", "is", null)
          .where(sql<SqlBool>`title like ${pattern} escape '\\'`)
          .orderBy((eb) => eb.fn.coalesce("last_message_at", "created_at"), "desc")
          .orderBy("id", "desc")
          .limit(limit),
      )
      .map(toChat)
  }

  /** Map a Flue session back to its chat row (the audit tap has only a session). */
  bySession(session: string): Chat | undefined {
    const row = this.#db.get(
      this.#db.qb.selectFrom("chats").selectAll().where("session", "=", session),
    )
    return row ? toChat(row) : undefined
  }

  /** Open a new side chat. */
  openSide(tenantId: string, agent: string, title?: string): Chat {
    return this.#insert(tenantId, agent, "side", title?.trim() || NEW_CHAT_TITLE, null)
  }

  rename(tenantId: string, id: number, title: string): Chat | undefined {
    this.#db.run(
      this.#db.qb
        .updateTable("chats")
        .set({ title })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return this.get(tenantId, id)
  }

  /** Close a chat (drops it from the tabs; the conversation stays). Not the main. */
  close(tenantId: string, id: number): Chat | undefined {
    const chat = this.get(tenantId, id)
    if (!chat) return undefined
    if (chat.kind === "main" && chat.closedAt === null) {
      throw new MainChatError("The main chat cannot be closed — start it over instead.")
    }
    this.#db.run(
      this.#db.qb
        .updateTable("chats")
        .set({ closed_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return this.get(tenantId, id)
  }

  /** Reopen a closed chat, always as a side chat so it cannot become a 2nd main. */
  reopen(tenantId: string, id: number): Chat | undefined {
    this.#db.run(
      this.#db.qb
        .updateTable("chats")
        .set({ closed_at: null, kind: "side" })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return this.get(tenantId, id)
  }

  /** Delete a chat row (Flue's copy stays, unreachable). Not the live main. */
  delete(tenantId: string, id: number): Chat | undefined {
    const chat = this.get(tenantId, id)
    if (!chat) return undefined
    if (chat.kind === "main" && chat.closedAt === null) {
      throw new MainChatError("The main chat cannot be deleted — start it over instead.")
    }
    this.#db.run(
      this.#db.qb.deleteFrom("chats").where("tenant_id", "=", tenantId).where("id", "=", id),
    )
    return chat
  }

  /** Start over: close the current main and open a fresh one. Nothing is deleted. */
  clearMain(tenantId: string, agent: string): Chat {
    const current = this.main(tenantId, agent)
    this.#db.run(
      this.#db.qb
        .updateTable("chats")
        .set({ closed_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", current.id),
    )
    return this.#insert(tenantId, agent, "main", MAIN_TITLE, null)
  }

  /** Record that a chat's session just produced a message (orders history). */
  touch(session: string, at: string = new Date().toISOString()): void {
    this.#db.run(
      this.#db.qb.updateTable("chats").set({ last_message_at: at }).where("session", "=", session),
    )
  }

  #historyQuery(tenantId: string, agent: string) {
    // Only closed chats — the ones you closed and the mains you started over.
    // Open chats (including a reopened side) live in the tabs, never here, so a
    // chat is never in both places at once.
    return this.#db.qb
      .selectFrom("chats")
      .where("tenant_id", "=", tenantId)
      .where("agent", "=", agent)
      .where("closed_at", "is not", null)
  }

  /**
   * Insert a chat, then write its real session computed from the row id.
   *
   * The session depends on the id (`__c<id>`/`__t<id>`), and the id is only
   * known after the insert, so a throwaway unique placeholder goes in first and
   * a second update writes the real value — all in one transaction.
   */
  #insert(
    tenantId: string,
    agent: string,
    kind: ChatKind,
    title: string,
    closedAt: string | null,
  ): Chat {
    const now = new Date().toISOString()
    const id = this.#db.transaction(() => {
      const inserted = this.#db.get<{ id: number }>(
        this.#db.qb
          .insertInto("chats")
          .values({
            tenant_id: tenantId,
            agent,
            session: `pending:${randomUUID()}`,
            title,
            kind,
            closed_at: closedAt,
            created_at: now,
            last_message_at: null,
          })
          .returning("id"),
      )
      if (!inserted) throw new Error("[chats] insert did not return an id")
      const session = this.#session(tenantId, agent, kind, inserted.id)
      this.#db.run(this.#db.qb.updateTable("chats").set({ session }).where("id", "=", inserted.id))
      return inserted.id
    })
    const chat = this.get(tenantId, id)
    if (!chat) throw new Error(`[chats] chat #${id} did not persist`)
    return chat
  }

  /**
   * The session key for a chat. The first main keeps the bare `tenant:agent`
   * (so pre-existing conversations are adopted in place); a later main is
   * `__c<id>`, a side chat `__t<id>`.
   */
  #session(tenantId: string, agent: string, kind: ChatKind, id: number): string {
    const base = `${tenantId}:${agent}`
    if (kind === "main" && !this.#hasOtherMainChat(tenantId, agent, id)) return base
    return `${base}__${kind === "main" ? "c" : "t"}${id}`
  }

  #hasOtherMainChat(tenantId: string, agent: string, exceptId: number): boolean {
    return (
      this.#db.get(
        this.#db.qb
          .selectFrom("chats")
          .select("id")
          .where("tenant_id", "=", tenantId)
          .where("agent", "=", agent)
          .where("kind", "=", "main")
          .where("id", "!=", exceptId),
      ) !== undefined
    )
  }
}

function toChat(row: Selectable<ChatTable>): Chat {
  return Chat.parse({
    id: row.id,
    tenantId: row.tenant_id,
    agent: row.agent,
    session: row.session,
    title: row.title,
    kind: row.kind,
    closedAt: row.closed_at ?? null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at ?? null,
  })
}

let store: ChatStore | undefined

export function getChatStore(): ChatStore {
  if (!store) store = new ChatStore(getDatabase())
  return store
}
