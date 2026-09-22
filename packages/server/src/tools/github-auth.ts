/**
 * GitHub OAuth for the `github` integration.
 *
 * Access only: an admin registers a GitHub OAuth app (client id + secret) and
 * each user authorizes their own account; the resulting token authorizes a
 * GitHub MCP connection (see `integrationBearer`). GitHub is used through MCP,
 * not a built-in tool — the same shape as the Slack integration.
 *
 * Tokens come in two shapes, and which one an app issues is the *app's* setting,
 * not ours. A classic OAuth app hands back an access token that never expires,
 * used as-is. An app with expiring tokens turned on (GitHub's default for apps
 * created since August 2026) hands back an access token good for 8 hours plus a
 * refresh token good for 6 months — so the stored credential keeps both, and
 * `githubAccessToken` refreshes the access token as it nears expiry. GitHub
 * *rotates* the refresh token on every refresh and revokes the one used, so the
 * caller must persist the returned `rotatedSecret`; `integrationBearer` does,
 * under a per-user lock, because agents fire several GitHub calls at once and a
 * second concurrent refresh would present a token the first one just revoked.
 *
 * Scopes decide what a token can reach; calls act as the person who connected.
 */

const AUTHORIZE = "https://github.com/login/oauth/authorize"
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token"

/**
 * Default scopes: repository contents plus org/user metadata. Classic OAuth has
 * no read-only repo scope, so `repo` is the way to reach private repositories;
 * an admin can trim to `public_repo` (or drop it) per instance.
 */
export const GITHUB_SCOPES = ["repo", "read:org", "read:user"]

/**
 * Refresh this long before the access token actually expires — it absorbs clock
 * skew, and keeps a token handed to a long agent turn from dying mid-turn.
 */
const EXPIRY_SKEW_MS = 5 * 60_000

interface GitHubConfig {
  clientId: string
  clientSecret: string
}

/** The per-user credential stored after a successful connect (JSON). */
export interface GitHubCredential {
  accessToken: string
  scope: string | null
  /** Present only when the app issues expiring tokens; else the access token is permanent. */
  refreshToken?: string
  /** Epoch ms at which `accessToken` expires. Absent ⇒ it does not expire. */
  accessTokenExpiresAt?: number
  /** Epoch ms at which `refreshToken` expires (~6 months) — after which reconnect. */
  refreshTokenExpiresAt?: number
}

/** The OAuth spec the generic connect/callback routes use. */
export const githubOAuth = {
  buildAuthUrl(
    config: GitHubConfig,
    redirectUri: string,
    state: string,
    scopes?: string[],
  ): string {
    const url = new URL(AUTHORIZE)
    url.searchParams.set("client_id", config.clientId)
    // GitHub takes a space-separated scope list (Slack uses commas).
    url.searchParams.set("scope", (scopes ?? GITHUB_SCOPES).join(" "))
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("state", state)
    return url.toString()
  },
  async exchange(code: string, config: GitHubConfig, redirectUri: string): Promise<string> {
    const token = await postToken(config, {
      code,
      redirect_uri: redirectUri,
    })
    return JSON.stringify(credentialFrom(token))
  },
}

/**
 * A usable access token for a stored GitHub credential, plus the replacement
 * credential to persist when a refresh rotated the refresh token.
 *
 * A credential with no refresh token holds a permanent access token, returned
 * as-is (the classic OAuth app shape, and everything connected before expiring
 * tokens existed). Otherwise the cached access token is reused until it nears
 * expiry and only then exchanged — refreshing on every call would burn the
 * rotating refresh token and fail the next call with `bad_refresh_token`.
 */
export async function githubAccessToken(
  userSecret: string,
  orgSecret?: string,
): Promise<{ accessToken?: string; rotatedSecret?: string }> {
  const credential = parseCredential(userSecret)
  // Not our JSON shape: an opaque token stored as-is. Use it verbatim.
  if (!credential) return { accessToken: userSecret || undefined }
  if (!credential.refreshToken) return { accessToken: credential.accessToken }

  // A cached access token still comfortably valid needs no refresh (and so no
  // rotation). Missing expiry ⇒ treat as expired and refresh.
  if (
    credential.accessTokenExpiresAt !== undefined &&
    credential.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now()
  ) {
    return { accessToken: credential.accessToken }
  }

  // The 6-month refresh token has run out: no grant left to exchange, and
  // GitHub's own `bad_refresh_token` does not say what to do about it.
  if (
    credential.refreshTokenExpiresAt !== undefined &&
    credential.refreshTokenExpiresAt <= Date.now()
  ) {
    throw new Error(
      "Your GitHub authorization has expired. Reconnect GitHub in Settings → Integrations.",
    )
  }

  const config = parseConfig(orgSecret)
  if (!config) {
    throw new Error(
      "The GitHub app is not configured, so its token cannot be refreshed. Add the client id and secret in Settings → Integrations.",
    )
  }
  const token = await postToken(config, {
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
  })
  const rotated = credentialFrom(token, credential)
  return { accessToken: rotated.accessToken, rotatedSecret: JSON.stringify(rotated) }
}

/** Parse a stored per-user credential; undefined when it is not our JSON shape. */
function parseCredential(secret: string): GitHubCredential | undefined {
  try {
    const parsed = JSON.parse(secret) as Partial<GitHubCredential>
    if (typeof parsed?.accessToken !== "string" || !parsed.accessToken) return undefined
    return { ...parsed, accessToken: parsed.accessToken, scope: parsed.scope ?? null }
  } catch {
    return undefined
  }
}

/** Parse the integration's org secret (`{ clientId, clientSecret }` JSON). */
function parseConfig(orgSecret?: string): GitHubConfig | undefined {
  if (!orgSecret) return undefined
  try {
    const parsed = JSON.parse(orgSecret) as Partial<GitHubConfig>
    const clientId = parsed.clientId?.trim()
    const clientSecret = parsed.clientSecret?.trim()
    return clientId && clientSecret ? { clientId, clientSecret } : undefined
  } catch {
    return undefined
  }
}

interface TokenResponse {
  access_token?: string
  scope?: string
  expires_in?: number
  refresh_token?: string
  refresh_token_expires_in?: number
  error?: string
  error_description?: string
}

/** Both grants (code, refresh) post here with the app's credentials attached. */
async function postToken(
  config: GitHubConfig,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    // Without this GitHub answers form-encoded; ask for JSON explicitly.
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      ...params,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })
  // GitHub answers 200 with { error, error_description } on failure.
  const body = (await response.json()) as TokenResponse
  if (body.error || !body.access_token) {
    throw new Error(`GitHub OAuth failed: ${body.error_description ?? body.error ?? "unknown"}`)
  }
  return body
}

/**
 * The credential to store from a token response. `previous` carries forward what
 * a refresh response omits: its `scope` is empty, and GitHub returns a new
 * refresh token every time — but keep the old one if it ever does not.
 */
function credentialFrom(token: TokenResponse, previous?: GitHubCredential): GitHubCredential {
  const now = Date.now()
  const refreshToken = token.refresh_token ?? previous?.refreshToken
  // A new refresh token carries a new lifetime; only an unrotated one keeps the
  // expiry we already knew.
  const refreshTokenExpiresAt = token.refresh_token_expires_in
    ? now + token.refresh_token_expires_in * 1000
    : token.refresh_token
      ? undefined
      : previous?.refreshTokenExpiresAt
  return {
    accessToken: token.access_token as string,
    scope: token.scope || previous?.scope || null,
    ...(refreshToken ? { refreshToken } : {}),
    ...(token.expires_in ? { accessTokenExpiresAt: now + token.expires_in * 1000 } : {}),
    ...(refreshTokenExpiresAt !== undefined ? { refreshTokenExpiresAt } : {}),
  }
}
