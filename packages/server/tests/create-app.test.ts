import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * M1's acceptance criteria, end to end over real HTTP with real better-auth
 * sessions: two accounts, each with their own agent, neither able to reach the
 * other's — and all of it still true after a restart.
 *
 * The agent router is stubbed. What is under test is the pipeline that decides
 * *whether* a turn is admitted and *whose* it is; the turn itself costs a model
 * call and proves nothing about the tenant seam.
 */

const home = mkdtempSync(join(tmpdir(), "staffroom-app-"))
process.env.STAFFROOM_HOME = home
// This suite signs up two accounts to test the tenant seam; keep sign-up open.
process.env.STAFFROOM_OPEN_SIGNUP = "1"

// Imported after STAFFROOM_HOME is set: the store and auth modules resolve
// their paths from it at module load.
const { createAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { createApp } = await import("../src/create-app.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")

/** Stands in for `createAgentRouter(StaffAgent)`: admitted, and says who. */
function stubAgentRouter() {
  const router = new Hono()
  router.all("/:id", (context) => context.json({ admitted: context.req.param("id") }))
  return router
}

/** Read a JSON body at the shape the caller expects. Tests validate by asserting. */
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface RosterBody {
  staff: { id: string; name: string; session: string }[]
}

/** The single roster entry a tenant is expected to have, asserted on the way out. */
function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1)
  const first = items[0]
  if (first === undefined) throw new Error("expected exactly one item")
  return first
}

function buildApp() {
  const auth = createAuth({
    databasePath: join(home, "staffroom.db"),
    secret: "test-secret-not-a-real-one",
    baseURL: "http://127.0.0.1:3000",
  })
  return { auth, app: createApp({ auth, agentRouter: stubAgentRouter(), uiDir: join(home, "ui") }) }
}

type App = ReturnType<typeof buildApp>["app"]

async function signUp(app: App, email: string): Promise<string> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  })
  expect(response.status, `sign-up for ${email}`).toBe(200)
  const cookie = response.headers.get("set-cookie")
  if (!cookie) throw new Error(`no session cookie for ${email}`)
  return cookie.split(";")[0] ?? ""
}

function as(cookie: string): RequestInit {
  return { headers: { cookie } }
}

describe("the request pipeline", () => {
  let app: App
  let alice: string
  let bob: string
  let aliceTenant: string
  let bobTenant: string

  beforeAll(async () => {
    const built = buildApp()
    app = built.app
    // Both schemas: ours, and better-auth's own. `app.ts` does this at boot;
    // this test mounts the pipeline directly, so it does it here.
    await migrateToLatest(getDatabase())
    await runAuthMigrations(built.auth)

    alice = await signUp(app, "alice@example.com")
    bob = await signUp(app, "bob@example.com")
    aliceTenant = (await json<{ tenantId: string }>(await app.request("/api/me", as(alice))))
      .tenantId
    bobTenant = (await json<{ tenantId: string }>(await app.request("/api/me", as(bob)))).tenantId

    for (const [cookie, name] of [
      [alice, "Alice's ops"],
      [bob, "Bob's ops"],
    ] as const) {
      const response = await app.request("/api/staff", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ id: "devops", name, systemPrompt: "You keep the lights on." }),
      })
      expect(response.status).toBe(201)
    }
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("gives two accounts two tenants", () => {
    expect(aliceTenant).toBeTruthy()
    expect(aliceTenant).not.toBe(bobTenant)
  })

  it("401s an unauthenticated data call", async () => {
    expect((await app.request("/api/me")).status).toBe(401)
    expect((await app.request("/api/staff")).status).toBe(401)
  })

  // Both created an agent called `devops`. Each sees exactly one.
  it("shows each caller only their own roster", async () => {
    const mine = only((await json<RosterBody>(await app.request("/api/staff", as(alice)))).staff)
    expect(mine.name).toBe("Alice's ops")
    expect(mine.session).toBe(`${aliceTenant}:devops`)

    const theirs = only((await json<RosterBody>(await app.request("/api/staff", as(bob)))).staff)
    expect(theirs.name).toBe("Bob's ops")
  })

  it("admits a caller to their own agent session", async () => {
    const response = await app.request(`/agents/${aliceTenant}:devops`, as(alice))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ admitted: `${aliceTenant}:devops` })
  })

  /**
   * The heart of it. Alice is properly signed in and simply types Bob's
   * session key. Flue takes the instance id straight from the URL, so without
   * this refusal the turn would be admitted and every layer below would read
   * the tenant back out of that key and agree with her.
   */
  it("refuses a caller naming another tenant's session", async () => {
    const response = await app.request(`/agents/${bobTenant}:devops`, as(alice))
    expect(response.status).toBe(403)
  })

  it("refuses a caller naming another tenant's job session", async () => {
    const response = await app.request(`/agents/${bobTenant}:devops__job-1`, as(alice))
    expect(response.status).toBe(403)
  })

  it("refuses an unparseable session key rather than guessing an owner", async () => {
    expect((await app.request("/agents/devops", as(alice))).status).toBe(400)
  })

  it("cannot be edited across tenants through the API", async () => {
    const patch = await app.request("/api/staff/devops", {
      method: "PATCH",
      headers: { cookie: alice, "content-type": "application/json" },
      body: JSON.stringify({ name: "hijacked" }),
    })
    expect(patch.status).toBe(200)

    // Alice edited *her* devops. Bob's is untouched, because the tenant came
    // from her session and never from the path.
    const theirs = only((await json<RosterBody>(await app.request("/api/staff", as(bob)))).staff)
    expect(theirs.name).toBe("Bob's ops")
  })

  /**
   * Restart. A second app over the same files, with no memory of the first:
   * the accounts, the sessions and the rosters are all still there and still
   * apart.
   */
  it("survives a restart", async () => {
    const restarted = buildApp().app

    const me = await restarted.request("/api/me", as(alice))
    expect(me.status).toBe(200)
    expect((await json<{ tenantId: string }>(me)).tenantId).toBe(aliceTenant)

    const roster = only(
      (await json<RosterBody>(await restarted.request("/api/staff", as(alice)))).staff,
    )
    expect(roster.name).toBe("hijacked")

    expect((await restarted.request(`/agents/${bobTenant}:devops`, as(alice))).status).toBe(403)
  })
})
