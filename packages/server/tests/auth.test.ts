import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Auth } from "../src/core/auth.ts"

/**
 * The plan's first open question: does better-auth run on `node:sqlite`, with
 * no native dependency and no adapter of our own? Everything in v2 sits on the
 * answer, so it is a test rather than a note.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-auth-"))
process.env.STAFFROOM_HOME = home

// Imported after STAFFROOM_HOME is set: the stores resolve their paths from it
// at module load. Signing up the first account puts it in a Default team, so the
// operational store has to live in this temp home — and be migrated — too.
const { createAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")

describe("better-auth on node:sqlite", () => {
  let auth: Auth

  beforeAll(async () => {
    auth = createAuth({
      databasePath: join(home, "staffroom.db"),
      secret: "test-secret-not-a-real-one",
      baseURL: "http://127.0.0.1:3000",
    })
    await migrateToLatest(getDatabase())
    await runAuthMigrations(auth)
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("creates its schema against a DatabaseSync handle", async () => {
    const user = await auth.api.signUpEmail({
      body: { email: "alice@example.com", password: "correct-horse-battery", name: "Alice" },
    })
    expect(user.user.id).toBeTruthy()
  })

  it("gives two accounts two distinct ids — which are the tenant ids", async () => {
    const bob = await auth.api.signUpEmail({
      body: { email: "bob@example.com", password: "correct-horse-battery", name: "Bob" },
    })
    const alice = await auth.api.signInEmail({
      body: { email: "alice@example.com", password: "correct-horse-battery" },
    })
    expect(bob.user.id).not.toBe(alice.user.id)
  })

  it("resolves a session back to the user the request belongs to", async () => {
    const signIn = await auth.api.signInEmail({
      body: { email: "alice@example.com", password: "correct-horse-battery" },
      asResponse: true,
    })
    const cookie = signIn.headers.get("set-cookie")
    expect(cookie).toBeTruthy()

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie ?? "" }),
    })
    expect(session?.user.email).toBe("alice@example.com")
  })

  // The session key format assumes a user id contains no ':' (see
  // @staffroom/protocol identity). We do not generate these, so this asserts
  // the assumption against ids better-auth actually produces.
  it("produces user ids the session key format can carry", async () => {
    const user = await auth.api.signUpEmail({
      body: { email: "carol@example.com", password: "correct-horse-battery", name: "Carol" },
    })
    expect(user.user.id).not.toContain(":")
  })
})
