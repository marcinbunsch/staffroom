import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { AuditEvent, type AuditEventInput, type SpendRow } from "@staffroom/protocol"
import { sql } from "kysely"
import type { Selectable } from "kysely"
import { STAFFROOM_HOME } from "../core/config.ts"
import { type AuditEventTable, type AuditSchema } from "./audit-schema.ts"
import { Database, openConnection } from "./database.ts"

/** What the log can be sliced by. Every one of these is a column. */
export interface AuditQuery {
  agent?: string
  type?: string
  session?: string
  jobId?: number
  /** ISO timestamps, inclusive. */
  since?: string
  until?: string
  limit?: number
}

/** What a spend total is grouped by. Columns only — no derived store to drift. */
export type SpendDimension = "agent" | "model" | "session" | "credential"

const SPEND_COLUMNS: Record<SpendDimension, keyof AuditEventTable> = {
  agent: "agent",
  model: "model",
  session: "session",
  credential: "credential_id",
}

/**
 * The append-only audit log.
 *
 * Only inserts and selects — the historical record is never rewritten. Reads
 * are always tenant-scoped; the one exception is
 * {@link AuditLog.spendAcrossTenants}, named so that the set of cross-tenant
 * reads stays small and greppable.
 */
export class AuditLog {
  readonly #db: Database<AuditSchema>

  constructor(db: Database<AuditSchema>) {
    this.#db = db
  }

  /** Record one event. Assigns the id and timestamp; returns the stored row. */
  record(input: AuditEventInput): AuditEvent {
    const id = randomUUID()
    const ts = new Date().toISOString()
    this.#db.run(
      this.#db.qb.insertInto("audit_events").values({
        id,
        ts,
        tenant_id: input.tenantId,
        actor_kind: input.actor.kind,
        actor_id: input.actor.kind === "agent" ? input.actor.id : null,
        agent: input.agent,
        session: input.session,
        job_id: input.jobId,
        type: input.type,
        model: input.usage.model,
        credential_id: input.usage.credentialId,
        tokens_in: input.usage.tokensIn,
        tokens_out: input.usage.tokensOut,
        cache_read: input.usage.cacheRead,
        cache_write: input.usage.cacheWrite,
        cost_total: input.usage.costTotal,
        payload: JSON.stringify(input.payload),
      }),
    )
    const stored = this.#db.get(
      this.#db.qb.selectFrom("audit_events").selectAll().where("id", "=", id),
    )
    if (!stored) throw new Error("[audit] the event did not persist")
    return rowToEvent(stored)
  }

  /**
   * The most recent events matching the filter, oldest-first — the newest N by
   * insertion order, then flipped, so the log reads top-to-bottom like a
   * transcript.
   */
  query(tenantId: string, filter: AuditQuery = {}): AuditEvent[] {
    let query = this.#db.qb.selectFrom("audit_events").selectAll().where("tenant_id", "=", tenantId)
    if (filter.agent) query = query.where("agent", "=", filter.agent)
    if (filter.type) query = query.where("type", "=", filter.type)
    if (filter.session) query = query.where("session", "=", filter.session)
    if (filter.jobId !== undefined) query = query.where("job_id", "=", filter.jobId)
    if (filter.since) query = query.where("ts", ">=", filter.since)
    if (filter.until) query = query.where("ts", "<=", filter.until)

    return this.#db
      .all(query.orderBy("seq", "desc").limit(clampLimit(filter.limit)))
      .map(rowToEvent)
      .reverse()
  }

  /**
   * Spend for one tenant, grouped by a dimension. A few `GROUP BY`s over
   * columns — which is the entire reason usage is columns.
   */
  spend(tenantId: string, dimension: SpendDimension, range: DateRange = {}): SpendRow[] {
    return this.#spendQuery(dimension, range, tenantId)
  }

  /** The admin view: the same totals with a tenant dimension. */
  spendAcrossTenants(range: DateRange = {}): SpendRow[] {
    return this.#spendQuery("tenant", range, undefined)
  }

  #spendQuery(
    dimension: SpendDimension | "tenant",
    range: DateRange,
    tenantId: string | undefined,
  ): SpendRow[] {
    const column = dimension === "tenant" ? "tenant_id" : SPEND_COLUMNS[dimension]
    let query = this.#db.qb
      .selectFrom("audit_events")
      // Only priced turns contribute; an agent_start has no cost and would
      // otherwise inflate the turn count.
      .where("type", "=", "model.turn")
      .select((eb) => [
        eb.ref(column).as("key"),
        eb.fn.countAll<number>().as("turns"),
        eb.fn.sum<number>("tokens_in").as("tokensIn"),
        eb.fn.sum<number>("tokens_out").as("tokensOut"),
        eb.fn.sum<number>("cache_read").as("cacheRead"),
        eb.fn.sum<number>("cache_write").as("cacheWrite"),
        eb.fn.sum<number>("cost_total").as("costTotal"),
      ])
      .groupBy(column)
      .orderBy(sql`sum(cost_total)`, "desc")
    if (tenantId !== undefined) query = query.where("tenant_id", "=", tenantId)
    if (range.since) query = query.where("ts", ">=", range.since)
    if (range.until) query = query.where("ts", "<=", range.until)

    return this.#db.all(query).map((row) => ({
      key: row.key === null ? "(none)" : String(row.key),
      turns: Number(row.turns ?? 0),
      tokensIn: Number(row.tokensIn ?? 0),
      tokensOut: Number(row.tokensOut ?? 0),
      cacheRead: Number(row.cacheRead ?? 0),
      cacheWrite: Number(row.cacheWrite ?? 0),
      costTotal: Number(row.costTotal ?? 0),
    }))
  }
}

export interface DateRange {
  since?: string
  until?: string
}

// 1..500; default 50. Keeps a runaway limit from reading the whole log.
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return 50
  return Math.max(1, Math.min(500, Math.floor(limit)))
}

function rowToEvent(row: Selectable<AuditEventTable>): AuditEvent {
  return AuditEvent.parse({
    id: row.id,
    sequence: row.seq,
    timestamp: row.ts,
    tenantId: row.tenant_id,
    actor:
      row.actor_kind === "agent" ? { kind: "agent", id: row.actor_id } : { kind: row.actor_kind },
    agent: row.agent ?? null,
    session: row.session ?? null,
    jobId: row.job_id ?? null,
    type: row.type,
    usage: {
      model: row.model ?? null,
      credentialId: row.credential_id ?? null,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      cacheRead: row.cache_read,
      cacheWrite: row.cache_write,
      costTotal: row.cost_total,
    },
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : {},
  })
}

let log: AuditLog | undefined
let database: Database<AuditSchema> | undefined

/** The audit log's own database, opened lazily. */
export function getAuditDatabase(): Database<AuditSchema> {
  if (!database) database = new Database(openConnection(join(STAFFROOM_HOME, "audit.db")))
  return database
}

/** The process-wide audit log, opened lazily on first use. */
export function getAuditLog(): AuditLog {
  if (!log) log = new AuditLog(getAuditDatabase())
  return log
}
