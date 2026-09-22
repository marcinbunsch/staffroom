import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GITHUB_SCOPES, githubAccessToken, githubOAuth } from "../../src/tools/github-auth.ts"
import { getIntegrationType } from "../../src/core/integrations.ts"

const config = { clientId: "abc123", clientSecret: "s3cr3t" }
const ORG_SECRET = JSON.stringify(config)
const REDIRECT = "https://staff.example.com/oauth/github/callback"

/** GitHub's own numbers for an app with expiring tokens: 8 hours / 6 months. */
const EIGHT_HOURS = 28_800
const SIX_MONTHS = 15_811_200

const NOW = Date.parse("2026-09-15T12:00:00.000Z")

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Mock the token endpoint, recording each posted body. */
function mockToken(body: Record<string, unknown>): URLSearchParams[] {
  const posts: URLSearchParams[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    posts.push(new URLSearchParams(String(init?.body)))
    return Response.json(body)
  })
  return posts
}

describe("github integration type", () => {
  it("is registered as an oauth type with a connect spec", () => {
    const type = getIntegrationType("github")
    expect(type?.kind).toBe("oauth")
    expect(type?.oauth).toBeDefined()
    expect(type?.defaultScopes).toEqual(GITHUB_SCOPES)
  })

  it("mints its bearer through the rotating path, so a refresh can be stored", () => {
    expect(getIntegrationType("github")?.rotatingBearer).toBeDefined()
  })
})

describe("githubOAuth.buildAuthUrl", () => {
  it("builds a consent URL with space-separated scopes and the state", () => {
    const url = new URL(githubOAuth.buildAuthUrl(config, REDIRECT, "state-token"))
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("abc123")
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT)
    expect(url.searchParams.get("state")).toBe("state-token")
    expect(url.searchParams.get("scope")).toBe(GITHUB_SCOPES.join(" "))
  })

  it("honours an explicit scope override", () => {
    const url = new URL(githubOAuth.buildAuthUrl(config, REDIRECT, "s", ["public_repo"]))
    expect(url.searchParams.get("scope")).toBe("public_repo")
  })
})

describe("githubOAuth.exchange", () => {
  it("stores the access token (and scope) as JSON", async () => {
    mockToken({ access_token: "gho_token", scope: "repo,read:org" })
    const stored = await githubOAuth.exchange("code-1", config, REDIRECT)
    expect(JSON.parse(stored)).toEqual({ accessToken: "gho_token", scope: "repo,read:org" })
  })

  it("keeps the refresh token and both expiries when the app issues expiring tokens", async () => {
    mockToken({
      access_token: "gho_token",
      scope: "repo",
      expires_in: EIGHT_HOURS,
      refresh_token: "ghr_refresh",
      refresh_token_expires_in: SIX_MONTHS,
    })
    expect(JSON.parse(await githubOAuth.exchange("code-1", config, REDIRECT))).toEqual({
      accessToken: "gho_token",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW + EIGHT_HOURS * 1000,
      refreshTokenExpiresAt: NOW + SIX_MONTHS * 1000,
    })
  })

  it("throws with GitHub's reason when the exchange fails", async () => {
    mockToken({ error: "bad_verification_code", error_description: "The code is bad." })
    await expect(githubOAuth.exchange("nope", config, REDIRECT)).rejects.toThrow("The code is bad.")
  })
})

describe("githubAccessToken", () => {
  it("uses a non-expiring token as-is, with nothing to store", async () => {
    const fetched = mockToken({})
    const stored = JSON.stringify({ accessToken: "gho_classic", scope: "repo" })
    expect(await githubAccessToken(stored, ORG_SECRET)).toEqual({ accessToken: "gho_classic" })
    expect(fetched).toHaveLength(0)
  })

  it("uses an opaque stored secret verbatim", async () => {
    expect(await githubAccessToken("gho_bare", ORG_SECRET)).toEqual({ accessToken: "gho_bare" })
  })

  it("reuses a cached access token that is still comfortably valid", async () => {
    const fetched = mockToken({})
    const stored = JSON.stringify({
      accessToken: "gho_live",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW + 3_600_000,
    })
    expect(await githubAccessToken(stored, ORG_SECRET)).toEqual({ accessToken: "gho_live" })
    expect(fetched).toHaveLength(0)
  })

  it("refreshes an expired token and returns the rotated credential to store", async () => {
    const fetched = mockToken({
      access_token: "gho_fresh",
      expires_in: EIGHT_HOURS,
      refresh_token: "ghr_rotated",
      refresh_token_expires_in: SIX_MONTHS,
    })
    const stored = JSON.stringify({
      accessToken: "gho_stale",
      scope: "repo,read:org",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW - 1000,
      refreshTokenExpiresAt: NOW + 3 * SIX_MONTHS,
    })
    const { accessToken, rotatedSecret } = await githubAccessToken(stored, ORG_SECRET)

    expect(accessToken).toBe("gho_fresh")
    expect(fetched[0]?.get("grant_type")).toBe("refresh_token")
    expect(fetched[0]?.get("refresh_token")).toBe("ghr_refresh")
    expect(fetched[0]?.get("client_id")).toBe("abc123")
    expect(fetched[0]?.get("client_secret")).toBe("s3cr3t")
    // The rotated refresh token replaces the one just spent, and the scope — which
    // a refresh response does not repeat — carries over.
    expect(JSON.parse(rotatedSecret!)).toEqual({
      accessToken: "gho_fresh",
      scope: "repo,read:org",
      refreshToken: "ghr_rotated",
      accessTokenExpiresAt: NOW + EIGHT_HOURS * 1000,
      refreshTokenExpiresAt: NOW + SIX_MONTHS * 1000,
    })
  })

  it("refreshes a token that is about to expire, not only one already expired", async () => {
    const fetched = mockToken({ access_token: "gho_fresh", expires_in: EIGHT_HOURS })
    const stored = JSON.stringify({
      accessToken: "gho_stale",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW + 60_000, // inside the skew window
    })
    expect((await githubAccessToken(stored, ORG_SECRET)).accessToken).toBe("gho_fresh")
    expect(fetched).toHaveLength(1)
  })

  it("keeps the prior refresh token when a refresh does not rotate it", async () => {
    mockToken({ access_token: "gho_fresh", expires_in: EIGHT_HOURS })
    const stored = JSON.stringify({
      accessToken: "gho_stale",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW - 1000,
      refreshTokenExpiresAt: NOW + SIX_MONTHS * 1000,
    })
    const { rotatedSecret } = await githubAccessToken(stored, ORG_SECRET)
    expect(JSON.parse(rotatedSecret!)).toMatchObject({
      refreshToken: "ghr_refresh",
      refreshTokenExpiresAt: NOW + SIX_MONTHS * 1000,
    })
  })

  it("asks for a reconnect once the refresh token itself has expired", async () => {
    const fetched = mockToken({})
    const stored = JSON.stringify({
      accessToken: "gho_stale",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW - 1000,
      refreshTokenExpiresAt: NOW - 1000,
    })
    await expect(githubAccessToken(stored, ORG_SECRET)).rejects.toThrow("Reconnect GitHub")
    expect(fetched).toHaveLength(0)
  })

  it("explains itself when the app config is missing, rather than posting without it", async () => {
    const fetched = mockToken({})
    const stored = JSON.stringify({
      accessToken: "gho_stale",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW - 1000,
    })
    await expect(githubAccessToken(stored, undefined)).rejects.toThrow("not configured")
    expect(fetched).toHaveLength(0)
  })

  it("surfaces GitHub's reason when the refresh grant is rejected", async () => {
    mockToken({ error: "bad_refresh_token", error_description: "The refresh token is invalid." })
    const stored = JSON.stringify({
      accessToken: "gho_stale",
      scope: "repo",
      refreshToken: "ghr_refresh",
      accessTokenExpiresAt: NOW - 1000,
    })
    await expect(githubAccessToken(stored, ORG_SECRET)).rejects.toThrow(
      "The refresh token is invalid.",
    )
  })
})
