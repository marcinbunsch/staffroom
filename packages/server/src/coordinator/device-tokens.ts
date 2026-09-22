import { type Database, getDatabase } from "./database.ts"

/** Web Push subscription keys — present only on `web` devices. */
export interface WebPushKeys {
  p256dh: string
  auth: string
}

/** A registered device, as push dispatch needs it. */
export interface DeviceToken {
  /** APNs device token, or the Web Push endpoint URL. */
  token: string
  platform: string
  /** The encryption keys for a `web` device; null for APNs. */
  keys: WebPushKeys | null
}

/**
 * Where a tenant's push notifications go — the device registry, one row per
 * destination.
 *
 * A destination is either an APNs device token (`ios`) or a Web Push endpoint
 * (`web`); the latter carries a `{ p256dh, auth }` key pair the payload is
 * encrypted against. Keyed by the token/endpoint itself, so a device that
 * re-registers (the token rotates, the subscription is renewed, the app
 * reinstalls) upserts rather than stacking duplicates. A destination can move
 * between tenants (a shared browser signs into another account), which the
 * upsert handles by rewriting `tenant_id`.
 *
 * Tenant-scoped like every other store: a dispatch for one account never reads
 * another's devices.
 */
export class DeviceTokenStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Register a device for a tenant, or move/refresh an existing token. */
  register(
    tenantId: string,
    token: string,
    platform: string,
    keys: WebPushKeys | null = null,
  ): void {
    const now = new Date().toISOString()
    const keysJson = keys ? JSON.stringify(keys) : ""
    this.#db.run(
      this.#db.qb
        .insertInto("device_tokens")
        .values({
          token,
          tenant_id: tenantId,
          platform,
          keys: keysJson,
          created_at: now,
          updated_at: now,
        })
        .onConflict((builder) =>
          builder
            .column("token")
            .doUpdateSet({ tenant_id: tenantId, platform, keys: keysJson, updated_at: now }),
        ),
    )
  }

  /**
   * Drop a device token. Scoped to the tenant that owns it so one account
   * cannot unregister another's device by guessing the token — a no-op when the
   * token is not theirs.
   */
  unregister(tenantId: string, token: string): void {
    this.#db.run(
      this.#db.qb
        .deleteFrom("device_tokens")
        .where("token", "=", token)
        .where("tenant_id", "=", tenantId),
    )
  }

  /**
   * Drop a token regardless of owner — for a push service telling us it is gone
   * (APNs 410, Web Push 404/410). The device is gone; the row is dead everywhere.
   */
  purge(token: string): void {
    this.#db.run(this.#db.qb.deleteFrom("device_tokens").where("token", "=", token))
  }

  /** Every device registered to a tenant, for dispatch to fan out over. */
  list(tenantId: string): DeviceToken[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("device_tokens")
          .select(["token", "platform", "keys"])
          .where("tenant_id", "=", tenantId),
      )
      .map((row) => ({ token: row.token, platform: row.platform, keys: parseKeys(row.keys) }))
  }
}

function parseKeys(raw: string): WebPushKeys | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as WebPushKeys
    return parsed.p256dh && parsed.auth ? parsed : null
  } catch {
    return null
  }
}

let store: DeviceTokenStore | undefined

export function getDeviceTokenStore(): DeviceTokenStore {
  if (!store) store = new DeviceTokenStore(getDatabase())
  return store
}
