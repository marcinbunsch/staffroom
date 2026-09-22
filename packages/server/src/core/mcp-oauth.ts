import { createHash, randomBytes } from "node:crypto"

/**
 * OAuth for MCP servers that advertise their own endpoints — the "auto-
 * discovered" flow. The server publishes RFC 9728 protected-resource metadata
 * pointing at an OAuth 2.0 authorization server (RFC 8414); we authorize with
 * PKCE. This is how Notion's and Sentry's hosted MCP servers authenticate: the
 * admin supplies only the server URL — there is no app to register by hand.
 *
 * The client is acquired one of two ways. When the server offers dynamic client
 * registration (RFC 7591) we register on the fly (Notion, Sentry) — no secret to
 * paste. When it does not (HubSpot: `registration_endpoint` is null and requires
 * a pre-registered "MCP auth app"), the admin pastes a client id/secret and it is
 * passed in as `client`; everything downstream — PKCE, refresh, resource binding
 * — is identical.
 *
 * Ported from the prototype's `mcp-oauth.ts`, trimmed to what a multi-tenant
 * server needs. The pending PKCE state lives in memory keyed by the OAuth
 * `state` (the same one `oauth-state` issues), so the browser round-trip carries
 * nothing sensitive; an in-flight flow that a restart drops is simply retried.
 * The durable per-user credential (below) keeps the refresh token, so a bearer
 * is minted the same stateless way the Google integration mints its own.
 */

const TTL_MS = 10 * 60_000

interface PendingMcpAuth {
  tokenUrl: string
  clientId: string
  clientSecret?: string
  redirectUri: string
  resource: string
  verifier: string
  expiresAt: number
}

const pending = new Map<string, PendingMcpAuth>()

/** The durable per-user credential stored after a successful connect (JSON). */
export interface McpOAuthCredential {
  tokenUrl: string
  clientId: string
  clientSecret?: string
  resource: string
  /** Present when the server issues refresh tokens; else `accessToken` is long-lived. */
  refreshToken?: string
  accessToken?: string
  /**
   * Epoch ms at which `accessToken` expires, when it was minted from a refresh
   * token. A still-valid cached token is reused rather than refreshed — which
   * also avoids rotating the refresh token on every call (see `mcpAccessToken`).
   */
  accessTokenExpiresAt?: number
}

/** Refresh a little before the access token actually expires, to absorb clock skew. */
const EXPIRY_SKEW_MS = 60_000

/**
 * Discover the server's OAuth endpoints, acquire a client (dynamic registration,
 * or the pre-registered one in `client` when given), and build the PKCE consent
 * URL. The `state` (minted by `oauth-state`) also keys the pending PKCE secret
 * here, so the callback can complete it.
 */
export async function startMcpOAuth(input: {
  url: string
  redirectUri: string
  state: string
  /** A pre-registered client (HubSpot). Absent ⇒ register dynamically. */
  client?: { clientId: string; clientSecret?: string }
}): Promise<{ authorizationUrl: string }> {
  const endpoint = new URL(input.url)
  const metadata = await discoverProtectedResource(endpoint)
  const authorizationServer = firstUrlFromArray(
    metadata.authorization_servers,
    "authorization_servers",
  )
  const server = await getJson<AuthorizationServer>(
    new URL("/.well-known/oauth-authorization-server", authorizationServer),
  )
  const authorizationEndpoint = requiredUrl(server.authorization_endpoint, "authorization_endpoint")
  const tokenUrl = requiredUrl(server.token_endpoint, "token_endpoint")
  const { clientId, clientSecret } = input.client
    ? input.client
    : await registerClient(server, input.redirectUri)

  // RFC 8707: bind the token to this MCP server as the audience. Prefer the
  // server's own canonical `resource` id (which may differ from the URL we were
  // given — e.g. HubSpot advertises `https://mcp.hubspot.com`, no trailing slash,
  // where `endpoint.href` would carry one); fall back to the endpoint otherwise.
  const resource = optionalString(metadata.resource, "resource") ?? endpoint.href

  const verifier = randomBytes(48).toString("base64url")
  sweep()
  pending.set(input.state, {
    tokenUrl,
    clientId,
    clientSecret,
    redirectUri: input.redirectUri,
    resource,
    verifier,
    expiresAt: Date.now() + TTL_MS,
  })

  const url = new URL(authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: input.redirectUri,
    resource,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: input.state,
    scope: requestedScopes(metadata),
  }).toString()
  return { authorizationUrl: url.href }
}

/**
 * Exchange the callback code (PKCE) and return the per-user credential to store.
 * Keeps the refresh token when the server issues one, so a later bearer refreshes
 * without another consent; otherwise keeps the long-lived access token.
 */
export async function completeMcpOAuth(state: string, code: string): Promise<string> {
  const auth = pending.get(state)
  pending.delete(state)
  if (!auth || auth.expiresAt < Date.now()) {
    throw new Error("No matching authorization session was found. Start the connection again.")
  }
  const token = await exchange(auth.tokenUrl, {
    grant_type: "authorization_code",
    code,
    redirect_uri: auth.redirectUri,
    client_id: auth.clientId,
    code_verifier: auth.verifier,
    resource: auth.resource,
    ...(auth.clientSecret ? { client_secret: auth.clientSecret } : {}),
  })
  const credential: McpOAuthCredential = {
    tokenUrl: auth.tokenUrl,
    clientId: auth.clientId,
    resource: auth.resource,
    ...(auth.clientSecret ? { clientSecret: auth.clientSecret } : {}),
    ...(token.refresh_token
      ? {
          // Seed the first access token alongside the refresh token so the very
          // first call serves from cache instead of immediately refreshing (and,
          // on a rotating server, burning this refresh token before it is used).
          refreshToken: token.refresh_token,
          accessToken: token.access_token,
          ...(token.expires_in
            ? { accessTokenExpiresAt: Date.now() + token.expires_in * 1000 }
            : {}),
        }
      : { accessToken: token.access_token }),
  }
  return JSON.stringify(credential)
}

/**
 * A usable access token for a stored MCP credential, plus the updated credential
 * to persist when the refresh rotated the refresh token.
 *
 * A credential without a refresh token holds a long-lived access token, returned
 * as-is. Otherwise a cached access token is reused until it nears expiry, and
 * only then exchanged for a fresh one. That caching is not just an optimization:
 * servers like Notion *rotate* refresh tokens — each `refresh_token` grant
 * returns a new refresh token and revokes the one used — so refreshing on every
 * call and discarding the rotation would revoke our own token after a single
 * use (HTTP 400 invalid_grant on the next call). When a refresh does happen the
 * caller must persist `rotatedSecret` so the next call presents the live token.
 */
export async function mcpAccessToken(
  secret: string,
): Promise<{ accessToken: string | undefined; rotatedSecret?: string }> {
  let credential: McpOAuthCredential
  try {
    credential = JSON.parse(secret) as McpOAuthCredential
  } catch {
    return { accessToken: undefined }
  }
  // No refresh token: the stored access token is long-lived, used as-is.
  if (!credential.refreshToken) return { accessToken: credential.accessToken }

  // A cached access token that is still comfortably valid needs no refresh (and
  // so no rotation). Missing expiry ⇒ treat as expired and refresh.
  if (
    credential.accessToken &&
    credential.accessTokenExpiresAt !== undefined &&
    credential.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now()
  ) {
    return { accessToken: credential.accessToken }
  }

  const token = await exchange(credential.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
    client_id: credential.clientId,
    resource: credential.resource,
    ...(credential.clientSecret ? { client_secret: credential.clientSecret } : {}),
  })
  const rotated: McpOAuthCredential = {
    ...credential,
    // Keep the prior refresh token if the server did not hand back a new one.
    refreshToken: token.refresh_token ?? credential.refreshToken,
    accessToken: token.access_token,
    accessTokenExpiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  }
  return { accessToken: token.access_token, rotatedSecret: JSON.stringify(rotated) }
}

// ─── Discovery, registration, exchange ───────────────────────────────────────

type ProtectedResource = {
  resource?: unknown
  authorization_servers?: unknown
  scopes_supported?: unknown
}
type AuthorizationServer = {
  authorization_endpoint?: unknown
  token_endpoint?: unknown
  registration_endpoint?: unknown
}
type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number }

async function discoverProtectedResource(endpoint: URL): Promise<ProtectedResource> {
  const pathSpecific = new URL(
    `/.well-known/oauth-protected-resource${endpoint.pathname.replace(/\/$/, "")}`,
    endpoint.origin,
  )
  try {
    return await getJson<ProtectedResource>(pathSpecific)
  } catch (error) {
    // RFC 9728 permits path-specific metadata, but some servers publish only the
    // root document. Fall back to it on a 404; surface any other failure.
    if (!(error instanceof DiscoveryError) || error.status !== 404) throw error
    return getJson<ProtectedResource>(
      new URL("/.well-known/oauth-protected-resource", endpoint.origin),
    )
  }
}

async function registerClient(
  metadata: AuthorizationServer,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret?: string }> {
  const registrationUrl = requiredUrl(metadata.registration_endpoint, "registration_endpoint")
  const registration = await postJson<{ client_id?: unknown; client_secret?: unknown }>(
    registrationUrl,
    {
      client_name: "Staffroom",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  )
  return {
    clientId: firstString(registration.client_id, "client_id"),
    clientSecret: optionalString(registration.client_secret, "client_secret"),
  }
}

async function exchange(tokenUrl: string, body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
  })
  if (!response.ok) {
    const code = oauthErrorCode(await response.text())
    throw new Error(
      `OAuth token exchange failed (HTTP ${response.status}${code ? `: ${code}` : ""}).`,
    )
  }
  const token = (await response.json()) as TokenResponse
  if (!token.access_token) throw new Error("OAuth token response had no access_token.")
  return token
}

async function getJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" } })
  if (!response.ok) throw new DiscoveryError(url.pathname, response.status)
  return (await response.json()) as T
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`OAuth client registration failed (HTTP ${response.status}).`)
  return (await response.json()) as T
}

class DiscoveryError extends Error {
  constructor(
    path: string,
    readonly status: number,
  ) {
    super(`OAuth discovery failed at ${path} (HTTP ${status}).`)
  }
}

/**
 * The scopes to request. Sentry publishes write scopes alongside a basic read
 * one — prefer the least-privileged start; other servers (e.g. Notion) define
 * their own minimal baseline, so request what the metadata advertises.
 */
function requestedScopes(resource: ProtectedResource): string {
  const scopes = Array.isArray(resource.scopes_supported)
    ? resource.scopes_supported.filter((scope): scope is string => typeof scope === "string")
    : []
  if (scopes.includes("org:read")) return "org:read"
  return scopes.join(" ")
}

function requiredUrl(value: unknown, field: string): string {
  const url = firstString(value, field)
  try {
    return new URL(url).href
  } catch {
    throw new Error(`OAuth metadata contains an invalid ${field}.`)
  }
}
function firstString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`OAuth metadata has no ${field}.`)
  return value
}
function firstUrlFromArray(value: unknown, field: string): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`OAuth metadata has no ${field}.`)
  }
  return requiredUrl(value[0], field)
}
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return firstString(value, field)
}
function oauthErrorCode(body: string): string | undefined {
  try {
    const value = JSON.parse(body) as { error?: unknown }
    return typeof value.error === "string" && /^[a-z0-9._-]{1,80}$/i.test(value.error)
      ? value.error
      : undefined
  } catch {
    return undefined
  }
}
function sweep(): void {
  const now = Date.now()
  for (const [state, auth] of pending) if (auth.expiresAt < now) pending.delete(state)
}
