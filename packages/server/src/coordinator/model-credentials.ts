import { randomUUID } from "node:crypto"
import {
  CODEX_UPSTREAM,
  type CredentialInput,
  type CredentialKind,
  ModelCredential,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import { RosterStore } from "./roster.ts"
import type { ModelCredentialTable } from "./schema.ts"
import { decryptSecret, encryptSecret } from "./secrets.ts"

/**
 * Where model credentials live.
 *
 * The visibility rule is the same one files use: **mine, plus what the
 * organization shares** — `tenant_id = me OR scope = 'org'`. One idiom, so
 * there is one shape to get right rather than a new one per feature.
 *
 * Secrets are encrypted on the way in and decrypted only where a turn actually
 * needs them, so a credential can be listed, labelled and attributed without
 * anything reading the plaintext.
 */

/** A credential plus its plaintext secret. Only the provider registry asks for this. */
export interface CredentialSecret {
  kind: CredentialKind
  upstream: string
  /** For `api_key`: the key. For `codex_oauth`: the serialized token record. */
  secret: string
}

export class CredentialInUseError extends Error {
  constructor(readonly agents: readonly string[]) {
    super(`credential is still used by: ${agents.join(", ")}`)
    this.name = "CredentialInUseError"
  }
}

export class ModelCredentialStore {
  readonly #db: Database
  readonly #roster: RosterStore

  constructor(db: Database) {
    this.#db = db
    this.#roster = new RosterStore(db)
  }

  /** Everything this tenant may use: their own, plus the organization's. */
  list(tenantId: string): ModelCredential[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("model_credentials")
          .selectAll()
          .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("scope", "=", "org")]))
          .orderBy("scope", "desc")
          .orderBy("created_at", "asc"),
      )
      .map(rowToCredential)
  }

  /** One credential, if this tenant may use it. */
  get(tenantId: string, id: string): ModelCredential | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("model_credentials")
        .selectAll()
        .where("id", "=", id)
        .where((eb) => eb.or([eb("tenant_id", "=", tenantId), eb("scope", "=", "org")])),
    )
    return row ? rowToCredential(row) : undefined
  }

  /**
   * The credential that staff rows naming none fall back to — any scope, so a
   * self-hosted admin's personal login can be it, not only an org key. Exactly
   * one row holds `is_default` (a unique index enforces it). Undefined when none
   * is marked.
   */
  defaultCredential(): ModelCredential | undefined {
    const row = this.#db.get(
      this.#db.qb.selectFrom("model_credentials").selectAll().where("is_default", "=", 1),
    )
    return row ? rowToCredential(row) : undefined
  }

  /**
   * Make one credential the default (clearing any prior), and record the model
   * agents fall back to on it. Both in one transaction, since the unique index
   * would reject two defaults existing at once. The caller must be able to see
   * the credential; the route gates this to admins.
   */
  setDefault(tenantId: string, id: string, defaultModel: string): ModelCredential | undefined {
    if (!this.get(tenantId, id)) return undefined
    const now = new Date().toISOString()
    this.#db.transaction(() => {
      this.#db.run(
        this.#db.qb
          .updateTable("model_credentials")
          .set({ is_default: 0, default_model: null })
          .where("is_default", "=", 1),
      )
      this.#db.run(
        this.#db.qb
          .updateTable("model_credentials")
          .set({ is_default: 1, default_model: defaultModel, updated_at: now })
          .where("id", "=", id),
      )
    })
    return this.get(tenantId, id)
  }

  /** Every credential, for boot-time provider registration. Admin reads only. */
  listAcrossTenants(): ModelCredential[] {
    return this.#db
      .all(this.#db.qb.selectFrom("model_credentials").selectAll().orderBy("created_at", "asc"))
      .map(rowToCredential)
  }

  /**
   * The plaintext secret, for the provider registry alone. Kept off
   * {@link ModelCredential} so that listing credentials — which the UI, the
   * API and the audit log all do — cannot leak one by accident.
   */
  secretOf(id: string): CredentialSecret | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("model_credentials")
        .select(["kind", "upstream", "secret"])
        .where("id", "=", id),
    )
    if (!row) return undefined
    return {
      kind: row.kind as CredentialKind,
      upstream: row.upstream,
      secret: decryptSecret(row.secret),
    }
  }

  create(tenantId: string | null, input: CredentialInput): ModelCredential {
    const id = randomUUID()
    const now = new Date().toISOString()
    const { upstream, secret, hint, baseUrl } = materialize(input)
    // An org credential belongs to the organization, so it carries no tenant
    // even though an admin created it.
    const owner = input.scope === "org" ? null : tenantId
    // The default may be any scope now, so a new default clears whatever held it
    // before, regardless of scope — matching the global unique index.
    const isDefault = input.isDefault

    // Clearing the old default and setting the new one must not be observable
    // apart: the unique index would reject the insert in between.
    this.#db.transaction(() => {
      if (isDefault) {
        this.#db.run(
          this.#db.qb.updateTable("model_credentials").set({ is_default: 0, default_model: null }),
        )
      }
      this.#db.run(
        this.#db.qb.insertInto("model_credentials").values({
          id,
          scope: input.scope,
          tenant_id: owner,
          kind: input.kind,
          upstream,
          label: input.label,
          secret: encryptSecret(secret),
          hint,
          base_url: baseUrl,
          is_default: isDefault ? 1 : 0,
          created_at: now,
          updated_at: now,
        }),
      )
    })
    return this.#require(id)
  }

  /** Replace a stored secret in place — how a rotated key or a re-import lands. */
  replaceSecret(id: string, secret: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("model_credentials")
        .set({ secret: encryptSecret(secret), updated_at: new Date().toISOString() })
        .where("id", "=", id),
    )
  }

  /** Rename a credential the caller owns (or an org one). Returns the updated row. */
  rename(tenantId: string, id: string, label: string): ModelCredential | undefined {
    if (!this.get(tenantId, id)) return undefined
    this.#db.run(
      this.#db.qb
        .updateTable("model_credentials")
        .set({ label, updated_at: new Date().toISOString() })
        .where("id", "=", id),
    )
    return this.get(tenantId, id)
  }

  /**
   * Delete, unless staff rows still name it.
   *
   * Refusing is the honest option. Nulling the column instead would silently
   * repoint someone's agent at the org credential — a different bill, decided
   * by a delete they made for another reason.
   */
  remove(tenantId: string, id: string): boolean {
    const credential = this.get(tenantId, id)
    if (!credential) return false

    const users = this.#roster.usingCredential(id)
    if (users.length > 0) throw new CredentialInUseError(users)

    return (
      this.#db.run(this.#db.qb.deleteFrom("model_credentials").where("id", "=", id)).changes > 0
    )
  }

  #require(id: string): ModelCredential {
    const row = this.#db.get(
      this.#db.qb.selectFrom("model_credentials").selectAll().where("id", "=", id),
    )
    if (!row) throw new Error(`credential "${id}" did not persist`)
    return rowToCredential(row)
  }
}

/** What actually gets stored, per kind, plus the hint shown back to an operator. */
function materialize(input: CredentialInput): {
  upstream: string
  secret: string
  hint: string
  baseUrl: string
} {
  if (input.kind === "api_key") {
    return {
      upstream: input.upstream,
      secret: input.apiKey,
      hint: hintOf(input.apiKey),
      baseUrl: "",
    }
  }
  // A local server's identifying detail is its endpoint, so that doubles as the
  // hint. Its secret is an optional bearer token — empty for a bare server that
  // accepts any token, a real key for one put behind LM Studio's API-key setting.
  if (input.kind === "local") {
    return {
      upstream: input.upstream,
      secret: input.apiKey ?? "",
      hint: input.baseUrl,
      baseUrl: input.baseUrl,
    }
  }
  return {
    upstream: CODEX_UPSTREAM,
    secret: JSON.stringify(input.authJson),
    hint: input.authJson.tokens.account_id ?? "ChatGPT login",
    baseUrl: "",
  }
}

// Enough to tell two keys apart, not enough to be one.
function hintOf(apiKey: string): string {
  return apiKey.length <= 8 ? "…" : `${apiKey.slice(0, 5)}…${apiKey.slice(-4)}`
}

/**
 * The Flue provider id a credential registers as.
 *
 * Derived rather than stored, so it cannot drift from the row. One provider
 * per credential is what makes per-tenant keys work at all: Flue's registry is
 * process-global and keyed by id, so the tenant has to be *in* the id.
 */
export function providerIdOf(credential: { id: string; scope: string; upstream: string }): string {
  const suffix = credential.scope === "org" ? "org" : credential.id.replaceAll("-", "").slice(0, 12)
  return `${credential.upstream}-${suffix}`
}

function rowToCredential(row: ModelCredentialTable): ModelCredential {
  return ModelCredential.parse({
    id: row.id,
    scope: row.scope,
    tenantId: row.tenant_id ?? null,
    kind: row.kind,
    upstream: row.upstream,
    label: row.label,
    isDefault: row.is_default === 1,
    defaultModel: row.default_model ?? null,
    hint: row.hint,
    baseUrl: row.base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    providerId: providerIdOf({ id: row.id, scope: row.scope, upstream: row.upstream }),
  })
}

let store: ModelCredentialStore | undefined

export function getModelCredentialStore(): ModelCredentialStore {
  if (!store) store = new ModelCredentialStore(getDatabase())
  return store
}
