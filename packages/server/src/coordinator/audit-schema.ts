import type { Generated, Kysely } from "kysely"
import { type Migration, Migrator } from "kysely/migration"
import type { Database } from "./database.ts"

/**
 * The audit log's own database.
 *
 * Separate from `staffroom.db` for two reasons. It is append-only and grows
 * without bound — every turn and every tool call — so it wants to be rotatable
 * and archivable without touching operational data. And it is the busiest
 * writer in the system: keeping it out of the file better-auth also writes to
 * means the two can never contend for a write lock, which matters more than
 * usual here because the driver is synchronous and a lock wait parks the
 * process.
 *
 * Nothing joins across the two, and nothing needs to — every question the spend
 * page asks is answered by columns on the audit row itself.
 */
export interface AuditEventTable {
  /** Insertion order, and the only ordering the log trusts. */
  seq: Generated<number>
  id: string
  ts: string
  tenant_id: string
  actor_kind: string
  actor_id: string | null
  agent: string | null
  session: string | null
  job_id: number | null
  type: string
  model: string | null
  credential_id: string | null
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_write: number
  cost_total: number
  payload: string
}

export interface AuditSchema {
  audit_events: AuditEventTable
}

export const auditMigrations: Record<string, Migration> = {
  "001-audit-events": {
    async up(db: Kysely<never>) {
      await db.schema
        .createTable("audit_events")
        .addColumn("seq", "integer", (column) => column.primaryKey().autoIncrement())
        .addColumn("id", "text", (column) => column.notNull())
        .addColumn("ts", "text", (column) => column.notNull())
        .addColumn("tenant_id", "text", (column) => column.notNull())
        .addColumn("actor_kind", "text", (column) => column.notNull())
        .addColumn("actor_id", "text")
        .addColumn("agent", "text")
        .addColumn("session", "text")
        .addColumn("job_id", "integer")
        .addColumn("type", "text", (column) => column.notNull())
        // Usage as columns from the first migration. Backfilling a blob into
        // columns is possible; recovering cost that was never recorded is not.
        .addColumn("model", "text")
        .addColumn("credential_id", "text")
        .addColumn("tokens_in", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("tokens_out", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("cache_read", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("cache_write", "integer", (column) => column.notNull().defaultTo(0))
        .addColumn("cost_total", "real", (column) => column.notNull().defaultTo(0))
        .addColumn("payload", "text", (column) => column.notNull())
        .execute()

      // The spend page's shape: one tenant, one date range.
      await db.schema
        .createIndex("audit_events_tenant_ts")
        .on("audit_events")
        .columns(["tenant_id", "ts"])
        .execute()
      await db.schema
        .createIndex("audit_events_session")
        .on("audit_events")
        .column("session")
        .execute()
      await db.schema.createIndex("audit_events_type").on("audit_events").column("type").execute()
    },
  },
}

export async function migrateAuditToLatest<S>(database: Database<S>): Promise<string[]> {
  const migrator = new Migrator({
    db: database.qb as unknown as Kysely<never>,
    provider: { getMigrations: async () => auditMigrations },
  })
  const { error, results } = await migrator.migrateToLatest()
  if (error) throw error
  return (results ?? []).map((result) => result.migrationName)
}
