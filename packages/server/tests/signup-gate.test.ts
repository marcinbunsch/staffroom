import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Sign-up is open only for first-run setup: the first account can be created,
 * then sign-up is closed and an admin adds people. `STAFFROOM_OPEN_SIGNUP`
 * re-opens it. The gate sits in front of better-auth's email sign-up route.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-signup-gate-"))
process.env.STAFFROOM_HOME = home
delete process.env.STAFFROOM_OPEN_SIGNUP

const { getAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { createApp } = await import("../src/create-app.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")
const { getTeamStore } = await import("../src/coordinator/teams.ts")

type App = ReturnType<typeof createApp>

function signUp(app: App, email: string) {
  return app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  })
}

/** Who the caller (identified by their sign-up cookie) resolves to. */
async function meOf(
  app: App,
  signUpResponse: Response,
): Promise<{ tenantId: string; role: string }> {
  const cookie = (signUpResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
  const me = await app.request("/api/me", { headers: { cookie } })
  return (await me.json()) as { tenantId: string; role: string }
}

describe("sign-up is first-run only", () => {
  let app: App

  beforeAll(async () => {
    app = createApp({ auth: getAuth(), agentRouter: new Hono(), uiDir: join(home, "ui") })
    await migrateToLatest(getDatabase())
    await runAuthMigrations(getAuth())
  })

  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    delete process.env.STAFFROOM_OPEN_SIGNUP
  })

  it("makes the first account an admin in a Default team, then closes sign-up", async () => {
    const first = await signUp(app, "first@example.com")
    expect(first.status).toBe(200)
    const me = await meOf(app, first)
    // The first account runs the place: admin, and seeded into a Default team.
    expect(me.role).toBe("admin")
    const teams = getTeamStore().listDetail()
    const def = teams.find((team) => team.name === "Default")
    expect(def).toBeDefined()
    expect(def?.members).toEqual([me.tenantId])

    const second = await signUp(app, "second@example.com")
    expect(second.status).toBe(403)
    expect(((await second.json()) as { error: string }).error).toMatch(/closed/i)
  })

  it("re-opens when STAFFROOM_OPEN_SIGNUP is set: new account is a plain user, no new team", async () => {
    process.env.STAFFROOM_OPEN_SIGNUP = "1"
    try {
      const third = await signUp(app, "third@example.com")
      expect(third.status).toBe(200)
      expect((await meOf(app, third)).role).toBe("user")
      // Still just the one Default team from the first account.
      expect(
        getTeamStore()
          .listDetail()
          .filter((team) => team.name === "Default"),
      ).toHaveLength(1)
    } finally {
      delete process.env.STAFFROOM_OPEN_SIGNUP
    }
  })
})
