import { randomUUID } from "node:crypto"
import { Widget, type WidgetInput } from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import { getOperatorEvents } from "./operator-events.ts"
import type { WidgetTable } from "./schema.ts"

/**
 * Widgets: an agent's durable, self-updating outputs. One row per widget, keyed
 * by `(tenant_id, agent_id, key)`; writing the same key **updates in place**, so
 * there is no history — the widget is the latest snapshot and the agent's memory
 * is the history behind it.
 *
 * Tenant-private throughout, like memory and jobs — every method scopes to
 * `tenant_id` and there is no org-shared read. No bytes and no search index; a
 * write rings the operator bus (`widget.changed`) so open boards and dashboards
 * refetch the latest without a reload.
 */
export class WidgetsStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Ring the operator bus — a widget this agent owns was written or removed. */
  #announce(tenantId: string, agentId: string): void {
    getOperatorEvents().publish({ tenantId, event: { type: "widget.changed", agent: agentId } })
  }

  /**
   * Create or update a widget. Re-using a `key` for the same agent updates the
   * existing row in place — preserving its `id` and `created_at` — so a schedule
   * that maintains `revenue-summary` writes to one widget, not a growing pile.
   */
  put(tenantId: string, agentId: string, input: WidgetInput): Widget {
    const widget = this.#db.transaction(() => {
      const existing = this.#byKey(tenantId, agentId, input.key)
      const now = new Date().toISOString()
      if (existing) {
        this.#db.run(
          this.#db.qb
            .updateTable("widgets")
            .set({
              type: input.type,
              title: input.title,
              content: input.content,
              updated_at: now,
            })
            .where("id", "=", existing.id),
        )
        return this.#require(existing.id)
      }
      const id = randomUUID()
      this.#db.run(
        this.#db.qb.insertInto("widgets").values({
          id,
          tenant_id: tenantId,
          agent_id: agentId,
          key: input.key,
          type: input.type,
          title: input.title,
          content: input.content,
          created_at: now,
          updated_at: now,
        }),
      )
      return this.#require(id)
    })
    // Rung after the commit, so a subscriber's refetch sees the written row.
    this.#announce(tenantId, agentId)
    return widget
  }

  /** One agent's widgets — the board read, most-recently-updated first. */
  listForAgent(tenantId: string, agentId: string): Widget[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("widgets")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("agent_id", "=", agentId)
          .orderBy("updated_at", "desc")
          .orderBy("id", "asc"),
      )
      .map(rowToWidget)
  }

  /** Every widget the tenant owns — for the dashboard picker, grouped by agent. */
  list(tenantId: string): Widget[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("widgets")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("agent_id", "asc")
          .orderBy("updated_at", "desc"),
      )
      .map(rowToWidget)
  }

  get(tenantId: string, id: string): Widget | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("widgets")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return row ? rowToWidget(row) : undefined
  }

  /** Delete a widget the tenant owns. Returns whether a row was removed. */
  remove(tenantId: string, id: string): boolean {
    // Read the row first so the event can name its agent; deleting cascades to
    // any dashboard placement of it, so those dashboards refetch too.
    const existing = this.get(tenantId, id)
    const result = this.#db.run(
      this.#db.qb.deleteFrom("widgets").where("tenant_id", "=", tenantId).where("id", "=", id),
    )
    if (result.changes > 0 && existing) this.#announce(tenantId, existing.agentId)
    return result.changes > 0
  }

  #byKey(tenantId: string, agentId: string, key: string): Widget | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("widgets")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("agent_id", "=", agentId)
        .where("key", "=", key),
    )
    return row ? rowToWidget(row) : undefined
  }

  #require(id: string): Widget {
    const row = this.#db.get(this.#db.qb.selectFrom("widgets").selectAll().where("id", "=", id))
    if (!row) throw new Error(`widget "${id}" did not persist`)
    return rowToWidget(row)
  }
}

function rowToWidget(row: WidgetTable): Widget {
  return Widget.parse({
    id: row.id,
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    key: row.key,
    type: row.type,
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  })
}

let store: WidgetsStore | undefined

export function getWidgetsStore(): WidgetsStore {
  if (!store) store = new WidgetsStore(getDatabase())
  return store
}
