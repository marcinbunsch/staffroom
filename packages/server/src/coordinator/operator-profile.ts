import type { OperatorProfile } from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"

/**
 * Who each tenant's staff work for — the operator profile, per tenant.
 *
 * A tenant *is* the operator (see `tenancy.md`), so this is a singleton per
 * account rather than an id-keyed collection: `tenant_id` is the whole key and
 * there is at most one row. It exists because an agent that reads Slack, GitHub,
 * and mail cannot otherwise tell which of the many names it finds is you.
 *
 * Read on every render (via {@link renderOperatorProfile}), so reads are
 * synchronous like every other store.
 */
export class OperatorProfileStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** The operator's profile, or an empty one until they write it. */
  get(tenantId: string): OperatorProfile {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("operator_profiles")
        .select(["text", "updated_at"])
        .where("tenant_id", "=", tenantId),
    )
    if (!row) return { text: "", updatedAt: null }
    return { text: row.text, updatedAt: row.updated_at }
  }

  /** Write the operator's profile, replacing any previous one. */
  set(tenantId: string, text: string): OperatorProfile {
    const updatedAt = new Date().toISOString()
    this.#db.run(
      this.#db.qb
        .insertInto("operator_profiles")
        .values({ tenant_id: tenantId, text, updated_at: updatedAt })
        .onConflict((builder) =>
          builder.column("tenant_id").doUpdateSet({ text, updated_at: updatedAt }),
        ),
    )
    return { text, updatedAt }
  }
}

let store: OperatorProfileStore | undefined

export function getOperatorProfileStore(): OperatorProfileStore {
  if (!store) store = new OperatorProfileStore(getDatabase())
  return store
}

/**
 * The block prepended to a tenant's agents' system prompts, or an empty string
 * when nothing has been written. Read fresh on each render, so an edit takes
 * effect on the next turn without a restart — and stable across turns while it
 * is unchanged, so it does not churn the prompt cache.
 */
export function renderOperatorProfile(tenantId: string): string {
  const profile = getOperatorProfileStore().get(tenantId).text.trim()
  if (profile === "") return ""
  return [
    "## Who you work for",
    "This is the person you report to — the operator. Names, handles, and accounts below are theirs, so when you find them in Slack, GitHub, Notion, or mail, that is them. Never guess whether something refers to the operator when this tells you.",
    "",
    profile,
  ].join("\n")
}
