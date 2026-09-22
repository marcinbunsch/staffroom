import type { Selectable } from "kysely"
import { type Database, getDatabase } from "./database.ts"
import type { IntegrationTable } from "./schema.ts"

import type { SandboxRepoInput } from "@staffroom/protocol"

/** A stored integration instance — an admin-registered app of some type. */
export interface IntegrationRecord {
  name: string
  label: string
  type: string
  scopes: string[]
  repos: SandboxRepoInput[]
  mcpUrl: string
  createdAt: string
  updatedAt: string
}

/** The metadata of one integration instance (its app config lives in tool_credentials). */
export interface IntegrationRecordInput {
  name: string
  label: string
  type: string
  scopes: string[]
  repos: SandboxRepoInput[]
  mcpUrl?: string
}

/**
 * Registered integration instances — org-wide config, keyed by slug name.
 *
 * Several instances of a type may exist (two Slack apps with different scopes).
 * This table holds only the metadata; the client id/secret and per-user tokens
 * live in the tool-credential store keyed by the same slug.
 */
export class IntegrationStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  list(): IntegrationRecord[] {
    return this.#db
      .all(this.#db.qb.selectFrom("integrations").selectAll().orderBy("name", "asc"))
      .map(rowToRecord)
  }

  get(name: string): IntegrationRecord | undefined {
    const row = this.#db.get(
      this.#db.qb.selectFrom("integrations").selectAll().where("name", "=", name),
    )
    return row ? rowToRecord(row) : undefined
  }

  put(input: IntegrationRecordInput): IntegrationRecord {
    const now = new Date().toISOString()
    const values = {
      label: input.label,
      type: input.type,
      scopes: JSON.stringify(input.scopes),
      repos: JSON.stringify(input.repos),
      mcp_url: input.mcpUrl ?? "",
      updated_at: now,
    }
    if (this.get(input.name)) {
      this.#db.run(
        this.#db.qb.updateTable("integrations").set(values).where("name", "=", input.name),
      )
    } else {
      this.#db.run(
        this.#db.qb
          .insertInto("integrations")
          .values({ name: input.name, ...values, created_at: now }),
      )
    }
    const saved = this.get(input.name)
    if (!saved) throw new Error(`integration "${input.name}" did not persist`)
    return saved
  }

  remove(name: string): boolean {
    return this.#db.run(this.#db.qb.deleteFrom("integrations").where("name", "=", name)).changes > 0
  }
}

function rowToRecord(row: Selectable<IntegrationTable>): IntegrationRecord {
  return {
    name: row.name,
    label: row.label,
    type: row.type,
    scopes: JSON.parse(row.scopes) as string[],
    repos: JSON.parse(row.repos ?? "[]") as SandboxRepoInput[],
    mcpUrl: row.mcp_url ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

let store: IntegrationStore | undefined

export function getIntegrationStore(): IntegrationStore {
  if (!store) store = new IntegrationStore(getDatabase())
  return store
}
