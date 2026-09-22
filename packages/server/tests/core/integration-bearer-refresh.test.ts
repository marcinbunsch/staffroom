import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Resolving a GitHub bearer when the app issues expiring tokens: the refresh has
 * to happen once per stale credential, and the rotated refresh token has to be
 * stored — GitHub revokes the one just spent, so a second concurrent refresh
 * would present a dead token and fail the call with `bad_refresh_token`.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-github-refresh-"))
process.env.STAFFROOM_HOME = home

const { getDatabase } = await import("../../src/coordinator/database.ts")
const { migrateToLatest } = await import("../../src/coordinator/migrations.ts")
const { getIntegrationStore } = await import("../../src/coordinator/integrations.ts")
const { getToolCredentialStore } = await import("../../src/coordinator/tool-credentials.ts")
const { integrationBearer } = await import("../../src/core/integrations.ts")

const EIGHT_HOURS = 28_800
const ALICE = "alice"

/** A connected account whose 8-hour access token has just run out. */
function expiredCredential(): string {
  return JSON.stringify({
    accessToken: "gho_stale",
    scope: "repo",
    refreshToken: "ghr_first",
    accessTokenExpiresAt: Date.now() - 1000,
  })
}

function storeUserToken(secret: string): void {
  getToolCredentialStore().put(ALICE, { scope: "user", tool: "github", secret })
}

function storedUserToken(): { accessToken: string; refreshToken?: string } {
  return JSON.parse(getToolCredentialStore().userToken(ALICE, "github") as string)
}

/** A token endpoint that rotates the refresh token, and rejects a spent one. */
function mockGitHub(): { refreshes: number } {
  const counter = { refreshes: 0 }
  const live = new Set(["ghr_first"])
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const body = new URLSearchParams(String(init?.body))
    const presented = body.get("refresh_token") ?? ""
    // Real GitHub answers 200 with an error body; a revoked token fails here.
    if (!live.delete(presented)) {
      return Response.json({ error: "bad_refresh_token", error_description: "Token is invalid." })
    }
    counter.refreshes += 1
    const rotated = `ghr_${counter.refreshes + 1}`
    live.add(rotated)
    // A slow round-trip, so parallel callers really do overlap.
    await new Promise((resolve) => setTimeout(resolve, 10))
    return Response.json({
      access_token: `gho_fresh_${counter.refreshes}`,
      expires_in: EIGHT_HOURS,
      refresh_token: rotated,
      refresh_token_expires_in: 15_811_200,
    })
  })
  return counter
}

beforeAll(async () => {
  await migrateToLatest(getDatabase())
  getIntegrationStore().put({
    name: "github",
    label: "GitHub",
    type: "github",
    scopes: ["repo"],
    repos: [],
  })
  getToolCredentialStore().put(null, {
    scope: "org",
    tool: "github",
    secret: JSON.stringify({ clientId: "abc123", clientSecret: "s3cr3t" }),
  })
})

beforeEach(() => storeUserToken(expiredCredential()))
afterEach(() => vi.restoreAllMocks())
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe("integrationBearer for github", () => {
  it("refreshes an expired token and stores the rotated credential", async () => {
    const github = mockGitHub()
    expect(await integrationBearer("github", ALICE)).toBe("gho_fresh_1")
    expect(github.refreshes).toBe(1)
    expect(storedUserToken()).toMatchObject({
      accessToken: "gho_fresh_1",
      refreshToken: "ghr_2",
    })
  })

  it("refreshes once for calls that arrive together, and hands them all the new token", async () => {
    const github = mockGitHub()
    const bearers = await Promise.all([
      integrationBearer("github", ALICE),
      integrationBearer("github", ALICE),
      integrationBearer("github", ALICE),
    ])
    expect(bearers).toEqual(["gho_fresh_1", "gho_fresh_1", "gho_fresh_1"])
    expect(github.refreshes).toBe(1)
  })

  it("reuses the stored token on later calls until it nears expiry", async () => {
    const github = mockGitHub()
    await integrationBearer("github", ALICE)
    expect(await integrationBearer("github", ALICE)).toBe("gho_fresh_1")
    expect(github.refreshes).toBe(1)
  })

  it("leaves a still-valid credential untouched", async () => {
    const github = mockGitHub()
    storeUserToken(
      JSON.stringify({
        accessToken: "gho_live",
        scope: "repo",
        refreshToken: "ghr_first",
        accessTokenExpiresAt: Date.now() + 3_600_000,
      }),
    )
    expect(await integrationBearer("github", ALICE)).toBe("gho_live")
    expect(github.refreshes).toBe(0)
  })

  it("returns undefined for someone who has not connected github", async () => {
    mockGitHub()
    expect(await integrationBearer("github", "bob")).toBeUndefined()
  })
})
