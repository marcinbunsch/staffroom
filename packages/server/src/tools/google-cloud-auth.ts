import { createSign } from "node:crypto"

/**
 * Google Cloud service-account auth for the `gcp` integration.
 *
 * The org secret is a service account JSON key. To authorize a call we mint a
 * short-lived OAuth2 access token from it: sign a JWT assertion with the
 * account's private key (RS256) and exchange it at the token endpoint. Tokens
 * are cached per (account, scopes) until just before they expire, so a burst of
 * calls does not re-sign each time.
 */

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

interface CachedToken {
  token: string
  expiresAt: number
}

const cache = new Map<string, CachedToken>()

/** An access token for the given service account JSON and scopes. */
export async function serviceAccountAccessToken(
  serviceAccountJson: string,
  scopes: string[],
): Promise<string> {
  const account = parseServiceAccount(serviceAccountJson)
  const scope = (
    scopes.length > 0 ? scopes : ["https://www.googleapis.com/auth/cloud-platform"]
  ).join(" ")
  const key = `${account.client_email}\n${scope}`
  const cached = cache.get(key)
  // Refresh a minute early, so a token never expires mid-call.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token

  const tokenUri = account.token_uri || DEFAULT_TOKEN_URI
  const now = Math.floor(Date.now() / 1000)
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    { iss: account.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 },
    account.private_key,
  )

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Google Cloud token exchange failed (${response.status}): ${await response.text()}`,
    )
  }
  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) throw new Error("Google Cloud token exchange returned no access token.")

  cache.set(key, {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  })
  return body.access_token
}

function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Partial<ServiceAccount>
  try {
    parsed = JSON.parse(json) as Partial<ServiceAccount>
  } catch {
    throw new Error("The Google Cloud service account is not valid JSON.")
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("The service account JSON is missing client_email or private_key.")
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri,
  }
}

function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: string,
): string {
  const encode = (value: object) => base64url(Buffer.from(JSON.stringify(value)))
  const signingInput = `${encode(header)}.${encode(claims)}`
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey)
  return `${signingInput}.${base64url(signature)}`
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
