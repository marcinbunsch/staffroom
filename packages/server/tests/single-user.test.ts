import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * A single-user server — the local one the desktop app runs. It has one
 * account, signed in by the app with a token only the two of them share; no
 * sign-up and no adding accounts; no teams gating toolsets; and it answers only
 * requests that name its own loopback address.
 */
const BASE = "http://127.0.0.1:4327"
const TOKEN = "local-token-for-tests"

const home = mkdtempSync(join(tmpdir(), "staffroom-single-user-"))
process.env.STAFFROOM_HOME = home
process.env.STAFFROOM_URL = BASE
process.env.STAFFROOM_SINGLE_USER = "1"
process.env.STAFFROOM_LOCAL_TOKEN = TOKEN

// Imported after the environment is set: paths and the mode are read from it.
const { createAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { createApp } = await import("../src/create-app.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")
const { getTeamStore } = await import("../src/coordinator/teams.ts")
const { getToolsetStore } = await import("../src/coordinator/toolsets.ts")
const { toolCatalog } = await import("../src/tools/registry.ts")

type App = ReturnType<typeof createApp>

function localSignIn(app: App, token?: string, origin = BASE) {
  return app.request(`${origin}/api/auth/local/sign-in`, {
    headers: token ? { "x-staffroom-local-token": token } : {},
  })
}

/** The session cookie a sign-in response set, ready to send back. */
function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
}

async function signedInCookie(app: App): Promise<string> {
  return cookieOf(await localSignIn(app, TOKEN))
}

describe("a single-user server", () => {
  let app: App

  beforeAll(async () => {
    const auth = createAuth({
      databasePath: join(home, "staffroom.db"),
      secret: "test-secret-not-a-real-one",
      baseURL: BASE,
    })
    app = createApp({ auth, agentRouter: new Hono(), uiDir: join(home, "ui") })
    await migrateToLatest(getDatabase())
    await runAuthMigrations(auth)
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    for (const name of ["STAFFROOM_URL", "STAFFROOM_SINGLE_USER", "STAFFROOM_LOCAL_TOKEN"]) {
      delete process.env[name]
    }
  })

  it("refuses local sign-in without the app's token", async () => {
    expect((await localSignIn(app)).status).toBe(401)
    expect((await localSignIn(app, "not-the-token")).status).toBe(401)
  })

  it("signs its one account in with the token: an admin, told it is single-user", async () => {
    const response = await localSignIn(app, TOKEN)
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/")

    const me = await app.request(`${BASE}/api/me`, { headers: { cookie: cookieOf(response) } })
    expect(me.status).toBe(200)
    const body = (await me.json()) as { tenantId: string; role: string; singleUser: boolean }
    expect(body.role).toBe("admin")
    expect(body.singleUser).toBe(true)

    // Signing in again reaches the same account rather than making another.
    const again = await app.request(`${BASE}/api/me`, {
      headers: { cookie: await signedInCookie(app) },
    })
    expect(((await again.json()) as { tenantId: string }).tenantId).toBe(body.tenantId)
  })

  it("closes sign-up, and adding accounts", async () => {
    const account = { email: "someone@example.com", password: "correct-horse-battery", name: "x" }
    const signUp = await app.request(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(account),
    })
    expect(signUp.status).toBe(403)

    const create = await app.request(`${BASE}/api/auth/admin/create-user`, {
      method: "POST",
      headers: {
        cookie: await signedInCookie(app),
        "content-type": "application/json",
        origin: BASE,
      },
      body: JSON.stringify(account),
    })
    expect(create.status).toBe(403)
  })

  it("makes every toolset usable without a team granting it", async () => {
    getToolsetStore().put({
      name: "docs",
      label: "Docs",
      kind: "mcp",
      integration: "docs",
      url: "https://mcp.example.com/mcp",
      transport: "streamable-http",
      tools: ["search"],
      gatedTools: [],
      toolDescriptions: {},
    })
    const response = await app.request(`${BASE}/api/teams/grants/me`, {
      headers: { cookie: await signedInCookie(app) },
    })
    const { toolsets } = (await response.json()) as { toolsets: string[] }
    const catalog = toolCatalog().map((tool) => tool.name)
    expect(toolsets).toEqual(expect.arrayContaining(["mcp:docs", ...catalog]))
    expect(
      getTeamStore()
        .listDetail()
        .flatMap((team) => team.grants),
    ).toEqual([])
  })

  it("answers only requests that name its loopback address", async () => {
    // A DNS-rebound hostname: the right address, the wrong name.
    expect((await app.request("http://attacker.example:4327/api/me")).status).toBe(403)
    expect((await localSignIn(app, TOKEN, "http://attacker.example:4327")).status).toBe(403)
    expect((await app.request("http://localhost:4327/api/me")).status).toBe(401)
  })

  it("keeps local sign-in inert once not single-user", async () => {
    delete process.env.STAFFROOM_SINGLE_USER
    try {
      expect((await localSignIn(app, TOKEN)).status).toBe(404)
    } finally {
      process.env.STAFFROOM_SINGLE_USER = "1"
    }
  })
})
