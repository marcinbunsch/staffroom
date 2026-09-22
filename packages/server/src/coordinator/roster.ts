import { StaffMember, type StaffMemberInput, type StaffMemberUpdate } from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import type { StaffTable } from "./schema.ts"

/** Thrown by {@link RosterStore.create} when a tenant already has that agent id. */
export class StaffExistsError extends Error {
  constructor(readonly id: string) {
    super(`staff member "${id}" already exists`)
    this.name = "StaffExistsError"
  }
}

/**
 * The staff roster.
 *
 * Every method takes `tenantId` first, deliberately and without exception.
 * A scoped handle (`roster.for(tenant).list()`) would read better and hide the
 * seam exactly where it needs to be visible — the failure mode here is not a
 * crash but a colleague's roster appearing in someone's sidebar, and a missing
 * `tenant_id` predicate is far easier to spot when the parameter that should
 * have fed it is sitting right there in the signature.
 *
 * Queries are built with Kysely and executed synchronously (see `database.ts`):
 * the agent render reads a member on every turn and cannot await.
 */
export class RosterStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  list(tenantId: string): StaffMember[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("staff")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("sort_order", "asc")
          .orderBy("id", "asc"),
      )
      .map(rowToMember)
  }

  get(tenantId: string, id: string): StaffMember | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("staff")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return row ? rowToMember(row) : undefined
  }

  create(tenantId: string, input: StaffMemberInput): StaffMember {
    if (this.get(tenantId, input.id)) throw new StaffExistsError(input.id)
    const now = new Date().toISOString()
    this.#db.run(
      this.#db.qb.insertInto("staff").values({
        tenant_id: tenantId,
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        system_prompt: input.systemPrompt,
        model: input.model ?? null,
        credential_id: input.credentialId ?? null,
        tools: JSON.stringify(input.tools ?? []),
        enabled: 1,
        sort_order: this.#nextSortOrder(tenantId),
        created_at: now,
        updated_at: now,
      }),
    )
    const created = this.get(tenantId, input.id)
    if (!created) throw new Error(`insert of staff "${input.id}" did not persist`)
    return created
  }

  update(tenantId: string, id: string, input: StaffMemberUpdate): StaffMember | undefined {
    const existing = this.get(tenantId, id)
    if (!existing) return undefined
    const updated = { ...existing, ...input }
    this.#db.run(
      this.#db.qb
        .updateTable("staff")
        .set({
          name: updated.name,
          description: updated.description,
          system_prompt: updated.systemPrompt,
          model: updated.model,
          credential_id: updated.credentialId,
          tools: JSON.stringify(updated.tools),
          enabled: updated.enabled ? 1 : 0,
          updated_at: new Date().toISOString(),
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return this.get(tenantId, id)
  }

  /** Delete a member. Their jobs and audit history are deliberately not touched. */
  remove(tenantId: string, id: string): boolean {
    return (
      this.#db.run(
        this.#db.qb.deleteFrom("staff").where("tenant_id", "=", tenantId).where("id", "=", id),
      ).changes > 0
    )
  }

  /** Every agent using a credential, so deleting one can say what it would break. */
  usingCredential(credentialId: string): string[] {
    return this.#db
      .all(this.#db.qb.selectFrom("staff").select("id").where("credential_id", "=", credentialId))
      .map((row) => row.id)
  }

  #nextSortOrder(tenantId: string): number {
    const rows = this.#db.all(
      this.#db.qb.selectFrom("staff").select("sort_order").where("tenant_id", "=", tenantId),
    )
    return rows.reduce((highest, row) => Math.max(highest, row.sort_order + 1), 0)
  }
}

// The row is untrusted at this boundary; StaffMember.parse validates it and
// gives us the typed record, so nothing downstream needs a cast. Kysely types
// the columns, but only Zod checks that what SQLite handed back matches what
// the column claims.
function rowToMember(row: StaffTable): StaffMember {
  return StaffMember.parse({
    tenantId: row.tenant_id,
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    model: row.model ?? null,
    credentialId: row.credential_id ?? null,
    tools: typeof row.tools === "string" ? JSON.parse(row.tools) : [],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

let store: RosterStore | undefined

/** The process-wide roster store, opened lazily on first use. */
export function getRosterStore(): RosterStore {
  if (!store) store = new RosterStore(getDatabase())
  return store
}
