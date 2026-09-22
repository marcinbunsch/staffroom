import { randomUUID } from "node:crypto"
import {
  type ToolCredential,
  ToolCredential as ToolCredentialSchema,
  type ToolCredentialInput,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import type { ToolCredentialTable } from "./schema.ts"
import { decryptSecret, encryptSecret } from "./secrets.ts"

/**
 * Secrets and grants for tools.
 *
 * Three row shapes, keyed by `scope`:
 * - `org` — one shared secret per tool (a Firecrawl key, an OAuth app config).
 * - `user` — one person's own token per tool (a Gmail token, a Sentry key).
 * - `grant` — one person's *access* to an org-level credential, with no secret
 *   of its own (GCP: a shared service account, a per-user allow).
 *
 * The registry composes these per a tool's provisioning shape and decides
 * whether to offer the tool at all.
 */
export class ToolCredentialStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** The shared org secret for a tool, if an admin configured one. */
  orgSecret(tool: string): string | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("tool_credentials")
        .select("secret")
        .where("tool", "=", tool)
        .where("scope", "=", "org"),
    )
    return row?.secret ? decryptSecret(row.secret) : undefined
  }

  /** One person's own token for a tool, if they connected it. */
  userToken(tenantId: string, tool: string): string | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("tool_credentials")
        .select("secret")
        .where("tool", "=", tool)
        .where("scope", "=", "user")
        .where("tenant_id", "=", tenantId),
    )
    return row?.secret ? decryptSecret(row.secret) : undefined
  }

  hasUserToken(tenantId: string, tool: string): boolean {
    return this.#exists(tool, "user", tenantId)
  }

  /**
   * Whether a user's stored token was last rejected by the provider (a 401), so
   * it needs reconnecting. False when there is no token, or the token is
   * believed good.
   */
  isStale(tenantId: string, tool: string): boolean {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("tool_credentials")
        .select("stale_at")
        .where("tool", "=", tool)
        .where("scope", "=", "user")
        .where("tenant_id", "=", tenantId),
    )
    return Boolean(row?.stale_at)
  }

  /** Flag a user's token as rejected by the provider — a no-op if none exists. */
  markStale(tenantId: string, tool: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("tool_credentials")
        .set({ stale_at: new Date().toISOString() })
        .where("tool", "=", tool)
        .where("scope", "=", "user")
        .where("tenant_id", "=", tenantId),
    )
  }

  /**
   * Clear a user token's stale flag after a call succeeds — so a transient 401
   * that resolved on its own does not leave the integration nagging to
   * reconnect. Scoped to rows that are actually stale, so the common
   * already-good path writes nothing.
   */
  clearStale(tenantId: string, tool: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("tool_credentials")
        .set({ stale_at: null })
        .where("tool", "=", tool)
        .where("scope", "=", "user")
        .where("tenant_id", "=", tenantId)
        .where("stale_at", "is not", null),
    )
  }

  /** Whether a user has been granted access to a tool's org credential (GCP). */
  isGranted(tenantId: string, tool: string): boolean {
    return this.#exists(tool, "grant", tenantId)
  }

  /** What a tenant may see: org credentials, plus their own tokens and grants. */
  list(tenantId: string): ToolCredential[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("tool_credentials")
          .selectAll()
          .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("scope", "=", "org")]))
          .orderBy("scope", "asc")
          .orderBy("tool", "asc"),
      )
      .map(rowToCredential)
  }

  get(tenantId: string, id: string): ToolCredential | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("tool_credentials")
        .selectAll()
        .where("id", "=", id)
        .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("scope", "=", "org")])),
    )
    return row ? rowToCredential(row) : undefined
  }

  /**
   * Store a credential or grant, replacing any existing one of the same shape.
   * `callerTenant` owns a `user` row; `org` and `grant` are admin acts (the
   * route checks the role) — a grant names the user it is for.
   */
  put(callerTenant: string | null, input: ToolCredentialInput): ToolCredential {
    const owner = ownerOf(callerTenant, input)
    const { secret, hint } = secretAndHint(input)
    const existing = this.#findExisting(input.tool, input.scope, owner)
    const now = new Date().toISOString()

    if (existing) {
      this.#db.run(
        this.#db.qb
          .updateTable("tool_credentials")
          // Reconnecting (or re-storing) a credential clears any prior staleness:
          // this secret is freshly authorized, so it is believed good again.
          .set({ secret, hint, updated_at: now, stale_at: null })
          .where("id", "=", existing),
      )
      return this.#require(existing)
    }
    const id = randomUUID()
    this.#db.run(
      this.#db.qb.insertInto("tool_credentials").values({
        id,
        tool: input.tool,
        scope: input.scope,
        tenant_id: owner,
        secret,
        hint,
        created_at: now,
        updated_at: now,
      }),
    )
    return this.#require(id)
  }

  remove(tenantId: string, id: string): boolean {
    return (
      this.#db.run(
        this.#db.qb
          .deleteFrom("tool_credentials")
          .where("id", "=", id)
          .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("scope", "=", "org")])),
      ).changes > 0
    )
  }

  /** Remove the org credential for a tool/integration by name (for integrations). */
  removeOrg(tool: string): boolean {
    return (
      this.#db.run(
        this.#db.qb
          .deleteFrom("tool_credentials")
          .where("tool", "=", tool)
          .where("scope", "=", "org"),
      ).changes > 0
    )
  }

  #exists(tool: string, scope: string, tenantId: string): boolean {
    return (
      this.#db.get(
        this.#db.qb
          .selectFrom("tool_credentials")
          .select("id")
          .where("tool", "=", tool)
          .where("scope", "=", scope)
          .where("tenant_id", "=", tenantId),
      ) !== undefined
    )
  }

  #findExisting(tool: string, scope: string, owner: string | null): string | undefined {
    let query = this.#db.qb
      .selectFrom("tool_credentials")
      .select("id")
      .where("tool", "=", tool)
      .where("scope", "=", scope)
    query =
      owner === null ? query.where("tenant_id", "is", null) : query.where("tenant_id", "=", owner)
    return this.#db.get(query)?.id
  }

  #require(id: string): ToolCredential {
    const row = this.#db.get(
      this.#db.qb.selectFrom("tool_credentials").selectAll().where("id", "=", id),
    )
    if (!row) throw new Error(`tool credential "${id}" did not persist`)
    return rowToCredential(row)
  }
}

function ownerOf(callerTenant: string | null, input: ToolCredentialInput): string | null {
  if (input.scope === "org") return null
  if (input.scope === "grant") return input.user
  return callerTenant
}

function secretAndHint(input: ToolCredentialInput): { secret: string; hint: string } {
  if (input.scope === "grant") return { secret: "", hint: "granted" }
  return { secret: encryptSecret(input.secret), hint: hintOf(input.secret) }
}

function hintOf(secret: string): string {
  return secret.length <= 8 ? "…" : `${secret.slice(0, 4)}…${secret.slice(-4)}`
}

function rowToCredential(row: ToolCredentialTable): ToolCredential {
  return ToolCredentialSchema.parse({
    id: row.id,
    tool: row.tool,
    scope: row.scope,
    tenantId: row.tenant_id ?? null,
    hint: row.hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

let store: ToolCredentialStore | undefined

export function getToolCredentialStore(): ToolCredentialStore {
  if (!store) store = new ToolCredentialStore(getDatabase())
  return store
}
