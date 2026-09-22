import { afterEach, describe, expect, it, vi } from "vitest"
import { completeMcpOAuth, mcpAccessToken, startMcpOAuth } from "../../src/core/mcp-oauth.ts"
import { getIntegrationType } from "../../src/core/integrations.ts"

const REDIRECT = "https://staff.example.com/oauth/notion/callback"

afterEach(() => vi.restoreAllMocks())

/**
 * Route a mocked `fetch` by URL + method, so one implementation serves the whole
 * discovery → registration → token-exchange chain. Records the token-exchange
 * bodies so a test can assert the grant type.
 */
function mockOAuthServer(tokens: {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}) {
  const exchanges: URLSearchParams[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes("/.well-known/oauth-protected-resource")) {
      return Response.json({
        authorization_servers: ["https://auth.example.com/"],
        scopes_supported: ["read", "write"],
      })
    }
    if (url.includes("/.well-known/oauth-authorization-server")) {
      return Response.json({
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
      })
    }
    if (url === "https://auth.example.com/register") {
      return Response.json({ client_id: "dcr-client-123" })
    }
    if (url === "https://auth.example.com/token") {
      exchanges.push(new URLSearchParams(String(init?.body)))
      return Response.json(tokens)
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return exchanges
}

describe("notion/sentry integration types", () => {
  it("register as auto-discovered mcp types with a server URL", () => {
    for (const [type, url] of [
      ["notion", "https://mcp.notion.com/mcp"],
      ["sentry", "https://mcp.sentry.dev/mcp"],
    ] as const) {
      const registered = getIntegrationType(type)
      expect(registered?.kind).toBe("mcp")
      expect(registered?.defaultMcpUrl).toBe(url)
      expect(registered?.oauth).toBeUndefined() // no hand-registered app
    }
  })
})

describe("the auto-discovered MCP OAuth flow", () => {
  it("discovers endpoints, registers a client, and builds a PKCE consent URL", async () => {
    mockOAuthServer({})
    const { authorizationUrl } = await startMcpOAuth({
      url: "https://mcp.example.com/mcp",
      redirectUri: REDIRECT,
      state: "state-1",
    })
    const url = new URL(authorizationUrl)
    expect(url.origin + url.pathname).toBe("https://auth.example.com/authorize")
    expect(url.searchParams.get("client_id")).toBe("dcr-client-123")
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT)
    expect(url.searchParams.get("state")).toBe("state-1")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBeTruthy()
    // RFC 8707: the token is bound to the MCP server as its audience.
    expect(url.searchParams.get("resource")).toBe("https://mcp.example.com/mcp")
    expect(url.searchParams.get("scope")).toBe("read write")
  })

  it("completes the exchange and keeps the refresh token", async () => {
    mockOAuthServer({ access_token: "at-1", refresh_token: "rt-1" })
    await startMcpOAuth({ url: "https://mcp.example.com/mcp", redirectUri: REDIRECT, state: "s2" })
    const secret = await completeMcpOAuth("s2", "auth-code")
    expect(JSON.parse(secret)).toMatchObject({
      tokenUrl: "https://auth.example.com/token",
      clientId: "dcr-client-123",
      refreshToken: "rt-1",
    })
  })

  it("refuses a callback whose state has no pending session", async () => {
    await expect(completeMcpOAuth("unknown-state", "code")).rejects.toThrow(
      "No matching authorization session",
    )
  })

  it("mints a fresh access token from a stored refresh token", async () => {
    const exchanges = mockOAuthServer({ access_token: "fresh-access" })
    const secret = JSON.stringify({
      tokenUrl: "https://auth.example.com/token",
      clientId: "dcr-client-123",
      resource: "https://mcp.example.com/mcp",
      refreshToken: "rt-1",
    })
    expect(await mcpAccessToken(secret)).toMatchObject({ accessToken: "fresh-access" })
    expect(exchanges[0]?.get("grant_type")).toBe("refresh_token")
  })

  it("captures a rotated refresh token so the caller can persist it", async () => {
    // Notion returns a new refresh token on every refresh and revokes the old
    // one; the rotated credential must carry rt-2 (not the spent rt-1).
    mockOAuthServer({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 })
    const secret = JSON.stringify({
      tokenUrl: "https://auth.example.com/token",
      clientId: "dcr-client-123",
      resource: "https://mcp.example.com/mcp",
      refreshToken: "rt-1",
    })
    const { accessToken, rotatedSecret } = await mcpAccessToken(secret)
    expect(accessToken).toBe("at-2")
    expect(rotatedSecret).toBeTruthy()
    expect(JSON.parse(rotatedSecret as string)).toMatchObject({
      refreshToken: "rt-2",
      accessToken: "at-2",
    })
  })

  it("reuses a cached access token without refreshing (avoiding needless rotation)", async () => {
    const exchanges = mockOAuthServer({ access_token: "should-not-be-called" })
    const secret = JSON.stringify({
      tokenUrl: "https://auth.example.com/token",
      clientId: "dcr-client-123",
      resource: "https://mcp.example.com/mcp",
      refreshToken: "rt-1",
      accessToken: "cached",
      accessTokenExpiresAt: Date.now() + 10 * 60_000,
    })
    expect(await mcpAccessToken(secret)).toEqual({ accessToken: "cached" })
    expect(exchanges).toHaveLength(0) // no token endpoint hit → no rotation
  })

  it("refreshes a cached access token that is near expiry", async () => {
    const exchanges = mockOAuthServer({ access_token: "renewed", expires_in: 3600 })
    const secret = JSON.stringify({
      tokenUrl: "https://auth.example.com/token",
      clientId: "dcr-client-123",
      resource: "https://mcp.example.com/mcp",
      refreshToken: "rt-1",
      accessToken: "stale",
      accessTokenExpiresAt: Date.now() + 5_000, // inside the skew window
    })
    expect((await mcpAccessToken(secret)).accessToken).toBe("renewed")
    expect(exchanges[0]?.get("grant_type")).toBe("refresh_token")
  })

  it("returns a long-lived access token as-is when there is no refresh token", async () => {
    const secret = JSON.stringify({
      tokenUrl: "https://auth.example.com/token",
      clientId: "c",
      resource: "r",
      accessToken: "long-lived",
    })
    expect(await mcpAccessToken(secret)).toEqual({ accessToken: "long-lived" })
  })
})
