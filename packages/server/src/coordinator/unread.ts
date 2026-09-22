import { type Database, getDatabase } from "./database.ts"

/**
 * Unread agent replies, per chat.
 *
 * Keyed by **session**, because the audit tap that increments it only ever sees
 * a session; `agent` and `tenant_id` ride alongside so the roster badge is a
 * SUM rather than a join back to the chats table. A chat the operator opens is
 * marked read, zeroing its count.
 */
export class UnreadStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Total unread per agent, for the roster badges. */
  counts(tenantId: string): Record<string, number> {
    const rows = this.#db.all(
      this.#db.qb
        .selectFrom("chat_unread")
        .select("agent")
        .select((eb) => eb.fn.sum<number>("count").as("total"))
        .where("tenant_id", "=", tenantId)
        .groupBy("agent"),
    )
    const counts: Record<string, number> = {}
    for (const row of rows) {
      const total = Number(row.total)
      if (total > 0) counts[row.agent] = total
    }
    return counts
  }

  /** Unread per session for one agent, for the tab badges. */
  sessions(tenantId: string, agent: string): Record<string, number> {
    const rows = this.#db.all(
      this.#db.qb
        .selectFrom("chat_unread")
        .select(["session", "count"])
        .where("tenant_id", "=", tenantId)
        .where("agent", "=", agent),
    )
    const counts: Record<string, number> = {}
    for (const row of rows) if (row.count > 0) counts[row.session] = row.count
    return counts
  }

  /** One more unread reply landed in this chat. */
  increment(tenantId: string, agent: string, session: string): void {
    const existing = this.#db.get<{ count: number }>(
      this.#db.qb.selectFrom("chat_unread").select("count").where("session", "=", session),
    )
    const now = new Date().toISOString()
    if (existing) {
      this.#db.run(
        this.#db.qb
          .updateTable("chat_unread")
          .set({ count: existing.count + 1, updated_at: now })
          .where("session", "=", session),
      )
      return
    }
    this.#db.run(
      this.#db.qb
        .insertInto("chat_unread")
        .values({ session, tenant_id: tenantId, agent, count: 1, updated_at: now }),
    )
  }

  /** The operator opened the chat — clear its unread count. */
  markRead(session: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("chat_unread")
        .set({ count: 0, updated_at: new Date().toISOString() })
        .where("session", "=", session),
    )
  }
}

let store: UnreadStore | undefined

export function getUnreadStore(): UnreadStore {
  if (!store) store = new UnreadStore(getDatabase())
  return store
}
