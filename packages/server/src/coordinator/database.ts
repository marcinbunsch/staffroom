import { mkdirSync } from "node:fs"
import { join } from "node:path"
import SqliteDatabase from "better-sqlite3"
import type { Database as SqliteConnection } from "better-sqlite3"
import { Kysely, SqliteDialect } from "kysely"
import type { Compilable } from "kysely"
import { STAFFROOM_HOME } from "../core/config.ts"
import type { Schema } from "./schema.ts"

/**
 * The operational database: Kysely for building queries and running
 * migrations, better-sqlite3 for executing them.
 *
 * better-sqlite3 is what Kysely's `SqliteDialect` is written against, so it
 * plugs in with no adapter of ours in between. It is **synchronous** — a query
 * blocks the event loop for its duration. That is a known and accepted cost:
 * every in-process SQLite driver has it (measured — `node:sqlite` and libsql
 * both block identically; an async signature over either is decoration), and
 * the only escapes are a worker thread or a database server.
 *
 * Synchronous execution is also what the agent render needs. Flue's
 * `AgentFunction` returns `string | undefined | void`, so `StaffAgent` cannot
 * await, and it reads the roster on every turn.
 *
 * Queries are still *built* with Kysely — typed columns, no hand-written SQL —
 * and `compile()` is synchronous, so building and executing stay on the same
 * side of the async line.
 */
export class Database<S = Schema> {
  /** Build queries here. Nothing executes until this class runs them. */
  readonly qb: Kysely<S>
  /** The raw connection, for what a query builder cannot express: pragmas, FTS5. */
  readonly connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.connection = connection
    this.qb = new Kysely<S>({ dialect: new SqliteDialect({ database: connection }) })
  }

  all<T>(query: Compilable<T>): T[] {
    const { sql, parameters } = query.compile()
    return this.connection.prepare(sql).all(bind(parameters)) as T[]
  }

  get<T>(query: Compilable<T>): T | undefined {
    const { sql, parameters } = query.compile()
    return this.connection.prepare(sql).get(bind(parameters)) as T | undefined
  }

  run(query: Compilable<unknown>): { changes: number } {
    const { sql, parameters } = query.compile()
    return { changes: this.connection.prepare(sql).run(bind(parameters)).changes }
  }

  /**
   * All-or-nothing. better-sqlite3's own `transaction()` wrapper would do this,
   * but it forbids any async inside — a constraint our synchronous callers
   * already satisfy, so this stays a plain BEGIN/COMMIT and one fewer concept.
   */
  transaction<T>(work: () => T): T {
    this.connection.exec("BEGIN")
    try {
      const result = work()
      this.connection.exec("COMMIT")
      return result
    } catch (error) {
      this.connection.exec("ROLLBACK")
      throw error
    }
  }
}

/**
 * SQLite has no boolean, and better-sqlite3 refuses to bind one rather than
 * guessing — loudly, which is right, but every store would otherwise have to
 * remember. Converting here means they do not.
 */
function bind(parameters: ReadonlyArray<unknown>): unknown[] {
  return parameters.map((value) => {
    if (typeof value === "boolean") return value ? 1 : 0
    if (value === undefined) return null
    return value
  })
}

let database: Database<Schema> | undefined

/**
 * The process-wide operational database. One connection, shared by every store,
 * because the driver is synchronous and two connections in one process would
 * only contend with each other.
 */
export function getDatabase(): Database<Schema> {
  if (!database) database = new Database(openConnection(join(STAFFROOM_HOME, "staffroom.db")))
  return database
}

/**
 * How long a blocked writer waits for the other connection's lock.
 *
 * This is not the usual "be patient" knob. The driver is synchronous, so a
 * connection waiting on a lock blocks the **event loop** — the whole server
 * stops, serving nobody, until the wait ends. So this value is really a budget
 * for how long we are willing to freeze the process.
 *
 * Two connections touch this file: the stores, and better-auth. WAL means
 * readers never block (measured: 166µs while a write lock was held), so only
 * writer-versus-writer can contend, and both sides write in well under a
 * millisecond. 250ms is several hundred times the realistic overlap while
 * capping the damage of a pathological one.
 *
 * The prototype used 5000ms, which was correct there — single user, one
 * connection, no second writer to contend with. Kept here it would mean a
 * five-second whole-server freeze that then fails with SQLITE_BUSY anyway.
 */
const BUSY_TIMEOUT_MS = 250

/** Open a connection with the pragmas every connection to this file needs. */
export function openConnection(path: string): SqliteConnection {
  if (path !== ":memory:") mkdirSync(STAFFROOM_HOME, { recursive: true })
  const connection = new SqliteDatabase(path)
  connection.pragma("journal_mode = WAL")
  connection.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
  connection.pragma("foreign_keys = ON")
  return connection
}
