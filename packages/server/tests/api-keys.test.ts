import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * API keys are how the CLI authenticates as a user without a browser session.
 * A key is minted through the cookie-authenticated `/api/keys` route, then sent
 * back in `x-api-key` on later requests — and the server must resolve it to the
 * same tenant a cookie would, because everything downstream keys off that id.
 *
 * `enableSessionForAPIKeys` on the apiKey plugin is what makes `getSession`
 * (and so `resolveCaller`) honour the header; it is off by default, so this is
 * the test that would catch it silently regressing.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-api-keys-"))
process.env.STAFFROOM_HOME = home

const { getAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { createApp } = await import("../src/create-app.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")

type App = ReturnType<typeof createApp>

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe("API keys authenticate the CLI", () => {
  let app: App
  let cookie: string
  let tenant: string

  beforeAll(async () => {
    // Same wiring as boot: keys-routes reads `getAuth()`, so createApp must be
    // handed that very instance or the two would sign with different secrets.
    app = createApp({ auth: getAuth(), agentRouter: new Hono(), uiDir: join(home, "ui") })
    await migrateToLatest(getDatabase())
    await runAuthMigrations(getAuth())

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "cli@example.com",
        password: "correct-horse-battery",
        name: "CLI",
      }),
    })
    cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
    tenant = (
      await jsonOf<{ tenantId: string }>(await app.request("/api/me", { headers: { cookie } }))
    ).tenantId
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("mints a key over a cookie session, then authenticates with it", async () => {
    const created = await app.request("/api/keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "laptop" }),
    })
    expect(created.status).toBe(201)
    const key = (await jsonOf<{ key: { key: string } }>(created)).key.key
    expect(key).toBeTruthy()

    // The whole point: a key resolves to the same tenant the cookie does.
    const withKey = await app.request("/api/me", { headers: { "x-api-key": key } })
    expect(withKey.status).toBe(200)
    expect((await jsonOf<{ tenantId: string }>(withKey)).tenantId).toBe(tenant)

    // And it shows up in the owner's list, without the plaintext.
    const list = await jsonOf<{ keys: { name: string | null; key?: string }[] }>(
      await app.request("/api/keys", { headers: { cookie } }),
    )
    expect(list.keys).toHaveLength(1)
    expect(list.keys[0]?.name).toBe("laptop")
    expect(list.keys[0]?.key).toBeUndefined()
  })

  it("does not throttle a CLI making many calls with one key", async () => {
    // The apiKey plugin defaults every key to 10 requests per 24h; a single CLI
    // command can exceed that. `rateLimit: { enabled: false }` turns it off, so
    // well past ten requests must all still authenticate.
    const created = await app.request("/api/keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "busy" }),
    })
    const key = (await jsonOf<{ key: { key: string } }>(created)).key.key
    for (let call = 0; call < 15; call++) {
      const response = await app.request("/api/me", { headers: { "x-api-key": key } })
      expect(response.status, `request #${call + 1}`).toBe(200)
    }
  })

  it("rejects a bad key as unauthorized, not a server error", async () => {
    const response = await app.request("/api/me", {
      headers: { "x-api-key": "definitely-not-a-real-key-but-long-enough-to-look-like-one" },
    })
    expect(response.status).toBe(401)
  })

  it("revokes a key so it stops authenticating", async () => {
    const created = await app.request("/api/keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "throwaway" }),
    })
    const minted = await jsonOf<{ key: { id: string; key: string } }>(created)
    expect(
      (await app.request("/api/me", { headers: { "x-api-key": minted.key.key } })).status,
    ).toBe(200)

    const removed = await app.request(`/api/keys/${minted.key.id}`, {
      method: "DELETE",
      headers: { cookie },
    })
    expect(removed.status).toBe(200)
    expect(
      (await app.request("/api/me", { headers: { "x-api-key": minted.key.key } })).status,
    ).toBe(401)
  })
})
