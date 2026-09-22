import { describe, expect, it } from "vitest"
import { Database, openConnection } from "../../src/coordinator/database.ts"
import { migrateToLatest, migrations } from "../../src/coordinator/migrations.ts"

function freshDatabase(): Database {
  return new Database(openConnection(":memory:"))
}

function tableNames(database: Database): string[] {
  return database.connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String((row as { name: string }).name))
}

describe("migrations", () => {
  it("creates the schema from empty", async () => {
    const database = freshDatabase()
    const { applied } = await migrateToLatest(database)

    expect(applied).toEqual(Object.keys(migrations))
    expect(tableNames(database)).toEqual(expect.arrayContaining(["staff", "model_credentials"]))
  })

  /** Boot runs this every time; the second run must do nothing. */
  it("is a no-op the second time", async () => {
    const database = freshDatabase()
    await migrateToLatest(database)

    expect((await migrateToLatest(database)).applied).toEqual([])
  })

  it("records what it applied, so a partial history resumes", async () => {
    const database = freshDatabase()
    await migrateToLatest(database)
    const recorded = database.connection
      .prepare("SELECT name FROM kysely_migration ORDER BY name")
      .all()
      .map((row) => String((row as { name: string }).name))

    expect(recorded).toEqual(Object.keys(migrations))
  })

  // Names order the run, so they have to sort into the order they were written.
  it("names migrations so lexical order is execution order", () => {
    const names = Object.keys(migrations)
    expect([...names].sort()).toEqual(names)
  })

  /**
   * The routines → schedules rename is an upgrade, not a rebuild: a routine row
   * written before it must survive as a schedule, its `schedule` column read as
   * `timing`, and `completed_at` seeded null (an active recurring schedule).
   */
  it("carries existing routines over as schedules", async () => {
    const database = freshDatabase()
    // Everything up to but not including the rename.
    const upToDashboards = Object.fromEntries(
      Object.entries(migrations).filter(([name]) => name !== "035-schedules"),
    )
    await migrateToLatest(database, upToDashboards)

    database.connection
      .prepare(
        `INSERT INTO routines
           (id, tenant_id, title, agent, instruction, schedule, catch_up, enabled,
            deadline_seconds, report_mode, last_fired_at, created_at, updated_at)
         VALUES
           ('r1', 'alice', 'Daily digest', 'devops', 'Summarize the day.',
            '{"kind":"cron","expression":"0 9 * * *"}', 0, 1,
            NULL, 'on_request', NULL, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      )
      .run()

    // Now apply the rename.
    expect((await migrateToLatest(database, migrations)).applied).toEqual(["035-schedules"])

    expect(tableNames(database)).toContain("schedules")
    expect(tableNames(database)).not.toContain("routines")
    const row = database.connection
      .prepare("SELECT id, title, timing, completed_at FROM schedules WHERE id = 'r1'")
      .get() as { id: string; title: string; timing: string; completed_at: string | null }
    expect(row.title).toBe("Daily digest")
    expect(JSON.parse(row.timing)).toEqual({ kind: "cron", expression: "0 9 * * *" })
    expect(row.completed_at).toBeNull()
  })

  /**
   * The schema `schema.ts` describes and the schema the migrations build are
   * two artifacts that can drift. Every store test runs against the migrated
   * database, which catches it — this states the rule outright.
   */
  it("builds the columns the stores query", async () => {
    const database = freshDatabase()
    await migrateToLatest(database)
    const columns = database.connection
      .prepare("SELECT name FROM pragma_table_info('staff')")
      .all()
      .map((row) => String((row as { name: string }).name))

    expect(columns).toEqual(
      expect.arrayContaining(["tenant_id", "id", "model", "credential_id", "sort_order"]),
    )
  })
})
