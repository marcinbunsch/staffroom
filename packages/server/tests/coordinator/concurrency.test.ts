import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * What synchronous SQLite costs, pinned as tests.
 *
 * `node:sqlite` is synchronous, so every query blocks the event loop for its
 * duration — the whole server serves nobody while a statement runs. That is
 * not a consequence of the Kysely adoption: Kysely's SQLite driver is `async`
 * in signature but entirely synchronous in body (`stmt.all()` blocks), and
 * better-sqlite3 behaves the same. Any in-process SQLite driver has this
 * property; the API shape on top of it is decoration.
 *
 * So the thing to control is not sync-versus-async, it is *how long any single
 * statement can block*. These cases fix the two answers that matter.
 */

let home: string

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "staffroom-concurrency-"))
  process.env.STAFFROOM_HOME = home
})

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe("two connections on one file", () => {
  /**
   * The dangerous case, and the reason `BUSY_TIMEOUT_MS` is 250 and not 5000.
   *
   * The stores and better-auth each hold a connection. If both write at once,
   * the loser waits — synchronously, freezing the process. At the prototype's
   * 5000ms this measured a 5.2 second whole-server freeze that then failed
   * with SQLITE_BUSY regardless. The wait must stay short enough that a
   * pathological overlap degrades to a fast error instead of an outage.
   */
  it("bounds how long a blocked writer can freeze the process", async () => {
    const { openConnection } = await import("../../src/coordinator/database.ts")
    const path = join(home, "contention.db")
    const stores = openConnection(path)
    const auth = openConnection(path)
    stores.exec("CREATE TABLE t (a INTEGER)")

    auth.exec("BEGIN IMMEDIATE")
    auth.prepare("INSERT INTO t VALUES (?)").run(1)

    const start = Date.now()
    expect(() => {
      stores.exec("BEGIN IMMEDIATE")
      stores.prepare("INSERT INTO t VALUES (?)").run(2)
      stores.exec("COMMIT")
    }).toThrow()
    const blockedMs = Date.now() - start

    // Generous upper bound: the point is that it is sub-second, not 5s.
    expect(blockedMs).toBeLessThan(1000)
    auth.exec("ROLLBACK")
  })

  /**
   * The reassuring case. WAL means a reader never waits for a writer, and
   * reads are almost everything this server does — every agent render is a
   * point lookup. This is why the contention above stays a narrow risk rather
   * than a general one.
   */
  it("never blocks a reader behind a writer", async () => {
    const { openConnection } = await import("../../src/coordinator/database.ts")
    const path = join(home, "readers.db")
    const stores = openConnection(path)
    const auth = openConnection(path)
    stores.exec("CREATE TABLE t (a INTEGER)")
    stores.prepare("INSERT INTO t VALUES (?)").run(1)

    auth.exec("BEGIN IMMEDIATE")
    auth.prepare("INSERT INTO t VALUES (?)").run(2)

    const start = Date.now()
    const row = stores.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }
    expect(Date.now() - start).toBeLessThan(100)
    // Sees the committed state, not the writer's uncommitted row.
    expect(row.c).toBe(1)

    auth.exec("ROLLBACK")
  })
})
