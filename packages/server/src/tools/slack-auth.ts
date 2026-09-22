/**
 * Slack OAuth for the `slack` integration.
 *
 * The integration only provides *access*: an admin registers a Slack app
 * (client id + secret) and each user authorizes their own account, and the
 * resulting token authorizes a Slack MCP connection (see `integrationBearer`).
 * Slack itself is used through MCP now, not a built-in tool.
 *
 * A Slack **user token** does not expire (unless token rotation is enabled,
 * which we do not request), so the stored access token is used as-is — no
 * refresh step. We ask for *user* scopes, so calls act as the person.
 */

const AUTHORIZE = "https://slack.com/oauth/v2/authorize"
const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access"

/** Read-only user scopes: channels/DMs, history, users, search. */
export const SLACK_USER_SCOPES = [
  "channels:read",
  "channels:history",
  "groups:read",
  "groups:history",
  "im:read",
  "im:history",
  "users:read",
  "search:read",
]

interface SlackConfig {
  clientId: string
  clientSecret: string
}

/** The OAuth spec the generic connect/callback routes use. */
export const slackOAuth = {
  buildAuthUrl(config: SlackConfig, redirectUri: string, state: string, scopes?: string[]): string {
    const url = new URL(AUTHORIZE)
    url.searchParams.set("client_id", config.clientId)
    // user_scope (not scope): we want a token that acts as the person.
    url.searchParams.set("user_scope", (scopes ?? SLACK_USER_SCOPES).join(","))
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("state", state)
    return url.toString()
  },
  async exchange(code: string, config: SlackConfig, redirectUri: string): Promise<string> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
      }),
    })
    // Slack returns 200 with { ok: false, error } on failure.
    const body = (await response.json()) as {
      ok?: boolean
      error?: string
      authed_user?: { access_token?: string }
      team?: { name?: string }
    }
    if (!body.ok) throw new Error(`Slack OAuth failed: ${body.error ?? "unknown"}`)
    const accessToken = body.authed_user?.access_token
    if (!accessToken) {
      throw new Error("Slack returned no user token — the app must request user scopes.")
    }
    return JSON.stringify({ accessToken, team: body.team?.name ?? null })
  },
}
