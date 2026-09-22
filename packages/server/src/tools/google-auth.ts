/**
 * Google OAuth for the `google` integration.
 *
 * The org config (an admin's OAuth app) is `{ clientId, clientSecret }`, stored
 * as the integration's org secret. A user connects by consenting once; we keep
 * their **refresh token** as the per-user credential, and exchange it for a
 * short-lived access token each time a bearer is needed (`googleAccessTokenFor`,
 * used to authorize a Google MCP connection). A revoked grant fails at that
 * exchange, not silently.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

/** Read-only Gmail and Calendar. Widen here (and re-consent) to add APIs. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
]

export interface GoogleAppConfig {
  clientId: string
  clientSecret: string
}

/** Parse the integration's org secret (`{ clientId, clientSecret }` JSON). */
export function parseGoogleConfig(orgSecret: string): GoogleAppConfig | undefined {
  try {
    const parsed = JSON.parse(orgSecret) as Partial<GoogleAppConfig>
    if (!parsed.clientId || !parsed.clientSecret) return undefined
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
  } catch {
    return undefined
  }
}

/** Parse a user's stored Google credential (`{ refreshToken }` JSON). */
export function parseGoogleUserToken(secret: string): string | undefined {
  try {
    const parsed = JSON.parse(secret) as { refreshToken?: string }
    return parsed.refreshToken || undefined
  } catch {
    // Older/plain storage: the whole secret is the refresh token.
    return secret || undefined
  }
}

/** The consent URL to send the user to. `access_type=offline` + `prompt=consent` force a refresh token. */
export function googleAuthUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  scopes?: string[]
}): string {
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", (input.scopes ?? GOOGLE_SCOPES).join(" "))
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("state", input.state)
  return url.toString()
}

/** Exchange the authorization code for tokens. Returns the refresh token to store. */
export async function exchangeGoogleCode(input: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<{ refreshToken: string }> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  })
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}): ${await response.text()}`)
  }
  const body = (await response.json()) as { refresh_token?: string }
  if (!body.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove the app's prior consent and reconnect.",
    )
  }
  return { refreshToken: body.refresh_token }
}

/** A short-lived access token from a stored refresh token. Refreshed each call. */
export async function googleAccessToken(input: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Google token refresh failed (${response.status}). Reconnect your Google account in Settings.`,
    )
  }
  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error("Google token refresh returned no access token.")
  return body.access_token
}

/**
 * The OAuth spec for the `google` integration, in the shape the generic connect
 * and callback routes use: build the consent URL, and exchange the code into the
 * per-user secret to store (a refresh token, as JSON).
 */
export const googleOAuth = {
  buildAuthUrl(
    config: { clientId: string; clientSecret: string },
    redirectUri: string,
    state: string,
    scopes?: string[],
  ): string {
    return googleAuthUrl({ clientId: config.clientId, redirectUri, state, scopes })
  },
  async exchange(
    code: string,
    config: { clientId: string; clientSecret: string },
    redirectUri: string,
  ): Promise<string> {
    const { refreshToken } = await exchangeGoogleCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri,
    })
    return JSON.stringify({ refreshToken })
  },
}

/** An access token from a tool's resolved credential (org config + user token). */
export async function googleAccessTokenFor(credential: {
  orgSecret?: string
  userToken?: string
}): Promise<string> {
  const config = credential.orgSecret ? parseGoogleConfig(credential.orgSecret) : undefined
  const refreshToken = credential.userToken ? parseGoogleUserToken(credential.userToken) : undefined
  if (!config || !refreshToken) {
    throw new Error(
      "Google is not fully connected. Connect your account in Settings → Integrations.",
    )
  }
  return googleAccessToken({
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  })
}
