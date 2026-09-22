import type { IntegrationTypeDef, IntegrationOAuth } from "@staffroom/plugin-core"
import { pluginIntegrationTypes } from "@staffroom/plugin-core"
import type {
  ConfigField,
  IntegrationInstance,
  IntegrationKind,
  IntegrationTypeInfo,
  SandboxRepoInput,
} from "@staffroom/protocol"
import { serverBaseUrl } from "./config.ts"
import { mcpAccessToken } from "./mcp-oauth.ts"
import { withRefreshLock } from "./refresh-lock.ts"
import { getIntegrationStore } from "../coordinator/integrations.ts"
import {
  type ToolCredentialStore,
  getToolCredentialStore,
} from "../coordinator/tool-credentials.ts"
import { dockerSandboxEnabled } from "../tools/docker-sandbox.ts"
import { serviceAccountAccessToken } from "../tools/google-cloud-auth.ts"
import { GITHUB_SCOPES, githubAccessToken, githubOAuth } from "../tools/github-auth.ts"
import { GOOGLE_SCOPES, googleAccessTokenFor, googleOAuth } from "../tools/google-auth.ts"
import { SLACK_USER_SCOPES, slackOAuth } from "../tools/slack-auth.ts"

/**
 * Integrations — an OAuth app an admin registers, that people connect their own
 * account to. There are a fixed set of **types** (Google, Slack) defined in
 * code, and any number of **instances** of each stored in the `integrations`
 * table: two Slack apps with different scopes, say. A toolset references an
 * instance by its slug name; the instance's per-user token authorizes it.
 *
 * The app config (client id + secret) and per-user tokens live in the tool
 * credential store, keyed by the instance slug. The OAuth flow is generic — the
 * type supplies an `oauth` spec (build the consent URL with the instance's
 * scopes, exchange the code into the per-user secret).
 *
 * The five types below are built in; a plugin can contribute more, and
 * {@link allTypes} merges them. `IntegrationTypeDef` / `IntegrationOAuth` are
 * defined in `@staffroom/plugin-core` so a plugin and the server share one shape.
 */
const GOOGLE: IntegrationTypeDef = {
  type: "google",
  kind: "oauth",
  label: "Google Workspace",
  description:
    "An OAuth app for Google (Gmail, Calendar, Drive). Register an app in Google Cloud, add this server's redirect URI, and paste the client id and secret. Each person then connects their own Google account.",
  configFields: [
    { key: "clientId", label: "Client ID", secret: false, optional: false },
    { key: "clientSecret", label: "Client secret", secret: true, optional: false },
  ],
  defaultScopes: GOOGLE_SCOPES,
  unlocks: ["Gmail", "Calendar", "Drive"],
  oauth: googleOAuth,
  // The stored secret is a refresh token; exchange it (with the org app config)
  // for a short-lived access token — the same path a Google MCP toolset uses.
  bearer: (userSecret, orgSecret) => googleAccessTokenFor({ orgSecret, userToken: userSecret }),
}

const SLACK: IntegrationTypeDef = {
  type: "slack",
  kind: "oauth",
  label: "Slack",
  description:
    "A Slack app that authorizes Slack access. Create an app at api.slack.com, add this server's redirect URL, request the scopes you want, and paste the client id and secret. Each person connects their own account; a Slack MCP toolset then uses that token.",
  configFields: [
    { key: "clientId", label: "Client ID", secret: false, optional: false },
    { key: "clientSecret", label: "Client secret", secret: true, optional: false },
  ],
  defaultScopes: SLACK_USER_SCOPES,
  unlocks: ["Slack"],
  oauth: slackOAuth,
  // The stored secret is JSON ({ accessToken, team }); the access token is the
  // bearer, usable as-is (Slack user tokens do not expire without rotation).
  bearer(userSecret) {
    try {
      const token = (JSON.parse(userSecret) as { accessToken?: string }).accessToken
      return token ?? userSecret
    } catch {
      return userSecret
    }
  },
}

const GITHUB: IntegrationTypeDef = {
  type: "github",
  kind: "oauth",
  label: "GitHub",
  description:
    "A GitHub OAuth app that authorizes GitHub access. Register an OAuth app in GitHub's Developer settings, set this server's redirect URI as the Authorization callback URL, and paste the client id and secret. Each person connects their own account; a GitHub MCP toolset then uses that token.",
  configFields: [
    { key: "clientId", label: "Client ID", secret: false, optional: false },
    { key: "clientSecret", label: "Client secret", secret: true, optional: false },
  ],
  defaultScopes: GITHUB_SCOPES,
  unlocks: ["GitHub"],
  oauth: githubOAuth,
  // The stored secret is JSON ({ accessToken, scope, refreshToken? }). A classic
  // app's access token is permanent and used as-is; an app with expiring tokens
  // turned on needs a refresh as the 8-hour token runs out, which hands back a
  // rotated credential to store (see `githubAccessToken`).
  rotatingBearer: githubAccessToken,
}

const NOTION: IntegrationTypeDef = {
  type: "notion",
  kind: "mcp",
  label: "Notion",
  description:
    "Notion through its hosted MCP server. There is no app to register — connecting authorizes your own Notion account through Notion's OAuth (the client is registered automatically). Add a Notion MCP toolset to expose its tools.",
  configFields: [],
  defaultScopes: [],
  unlocks: ["Notion"],
  defaultMcpUrl: "https://mcp.notion.com/mcp",
}

const SENTRY: IntegrationTypeDef = {
  type: "sentry",
  kind: "mcp",
  label: "Sentry",
  description:
    "Sentry through its hosted MCP server. There is no app to register — connecting authorizes your own Sentry account through Sentry's OAuth (read access; the client is registered automatically). Add a Sentry MCP toolset to expose its tools.",
  configFields: [],
  defaultScopes: [],
  unlocks: ["Sentry"],
  defaultMcpUrl: "https://mcp.sentry.dev/mcp",
}

const HUBSPOT: IntegrationTypeDef = {
  type: "hubspot",
  kind: "mcp",
  label: "HubSpot",
  description:
    "HubSpot through its hosted MCP server. Unlike Notion/Sentry it has no dynamic client registration: create an MCP auth app in HubSpot (Development → MCP Auth Apps), set this server's redirect URI as its OAuth URL, and paste the client id and secret. Each person then connects their own HubSpot account; a HubSpot MCP toolset uses that token.",
  configFields: [
    { key: "clientId", label: "Client ID", secret: false, optional: false },
    { key: "clientSecret", label: "Client secret", secret: true, optional: false },
  ],
  defaultScopes: [],
  unlocks: ["HubSpot"],
  // Scopes are automatic (bounded by what the connecting user can do in HubSpot);
  // the OAuth endpoints and PKCE are auto-discovered from this URL.
  defaultMcpUrl: "https://mcp.hubspot.com",
}

const DOCKER: IntegrationTypeDef = {
  type: "docker",
  kind: "docker",
  label: "Docker Sandbox",
  description:
    "A Docker sandbox — a private shell and filesystem the agent works in (/work, /tmp), with no network. Add repositories to mount read-only for reference; a sandbox with no repos is just a scratch environment. Needs the Docker daemon up and the sandbox image built.",
  configFields: [],
  defaultScopes: [],
  unlocks: ["Sandbox"],
}

const GCP: IntegrationTypeDef = {
  type: "gcp",
  kind: "gcp",
  label: "Google Cloud",
  description:
    "A Google Cloud service account. Paste its JSON key and pick the scopes; a GCP MCP toolset then authenticates with a short-lived token minted from it. Access is org-wide (one service account) — who may use it is decided by teams.",
  configFields: [
    { key: "serviceAccount", label: "Service account JSON", secret: true, optional: false },
  ],
  defaultScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  unlocks: ["Google Cloud"],
}

const FIRECRAWL: IntegrationTypeDef = {
  type: "firecrawl",
  kind: "token",
  label: "Firecrawl",
  description:
    "Firecrawl web scraping/crawling, via its hosted MCP server. Paste your Firecrawl API key; add a Firecrawl MCP toolset and its URL is prefilled. The key is org-wide (one account) — who may use it is decided by teams.",
  configFields: [{ key: "apiKey", label: "API key", secret: true, optional: false }],
  defaultScopes: [],
  unlocks: ["Firecrawl"],
  defaultMcpUrl: "https://mcp.firecrawl.dev/v2/mcp",
}

const BUILTIN_TYPES: IntegrationTypeDef[] = [
  GOOGLE,
  SLACK,
  GITHUB,
  NOTION,
  SENTRY,
  HUBSPOT,
  DOCKER,
  GCP,
  FIRECRAWL,
]

/** The reserved type slugs a plugin may not shadow — used by the boot guard. */
export const BUILTIN_INTEGRATION_TYPES: readonly string[] = BUILTIN_TYPES.map((type) => type.type)

/**
 * Every integration type — built-in plus plugin-contributed. Built-ins come
 * first, so a lookup resolves them before any plugin type; the boot guard
 * (`assertPluginsCompatible`) has already rejected a plugin that shadows one, so
 * there is no ambiguity here at run time.
 */
function allTypes(): IntegrationTypeDef[] {
  return [...BUILTIN_TYPES, ...pluginIntegrationTypes()]
}

/** A resolved instance: its stored metadata joined with its type's behaviour. */
export interface Integration {
  name: string
  kind: IntegrationKind
  label: string
  type: string
  scopes: string[]
  repos: SandboxRepoInput[]
  description: string
  configFields: ConfigField[]
  unlocks: string[]
  /** The effective MCP URL: the instance's own if set, else the type's default. */
  mcpUrl?: string
  oauth?: IntegrationOAuth
  bearer?(userSecret: string, orgSecret?: string): Promise<string> | string
  rotatingBearer?(
    userSecret: string,
    orgSecret?: string,
  ): Promise<{ accessToken?: string; rotatedSecret?: string }>
}

/** The registerable types, for the "add integration" picker. */
export function integrationTypes(): IntegrationTypeInfo[] {
  return allTypes().map((type) => ({
    type: type.type,
    kind: type.kind,
    label: type.label,
    description: type.description,
    configFields: type.configFields,
    defaultScopes: type.defaultScopes,
    unlocks: type.unlocks,
    defaultMcpUrl: type.defaultMcpUrl,
  }))
}

export function getIntegrationType(type: string): IntegrationTypeDef | undefined {
  return allTypes().find((candidate) => candidate.type === type)
}

/** Resolve one instance by slug — its stored row joined with its type. */
export function getIntegration(name: string): Integration | undefined {
  const record = getIntegrationStore().get(name)
  if (!record) return undefined
  const type = getIntegrationType(record.type)
  if (!type) return undefined
  return {
    name: record.name,
    kind: type.kind,
    label: record.label,
    type: record.type,
    scopes: record.scopes,
    repos: record.repos,
    description: type.description,
    configFields: type.configFields,
    unlocks: type.unlocks,
    mcpUrl: record.mcpUrl || type.defaultMcpUrl,
    oauth: type.oauth,
    bearer: type.bearer,
    rotatingBearer: type.rotatingBearer,
  }
}

/** The repos a Docker Sandbox integration mounts, or [] if it is not one. */
export function integrationRepos(name: string): SandboxRepoInput[] {
  const integration = getIntegration(name)
  return integration?.kind === "docker" ? integration.repos : []
}

/** The instance catalog with each one's configured (org) and connected (user) state. */
export function integrationCatalog(
  tenantId: string,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): IntegrationInstance[] {
  return getIntegrationStore()
    .list()
    .map((record) => {
      const type = getIntegrationType(record.type)
      const kind = type?.kind ?? "oauth"
      return {
        name: record.name,
        kind,
        label: record.label,
        type: record.type,
        scopes: record.scopes,
        repos: record.repos,
        description: type?.description ?? "",
        configFields: type?.configFields ?? [],
        unlocks: type?.unlocks ?? [],
        mcpUrl: record.mcpUrl || type?.defaultMcpUrl,
        // The exact redirect URI to register with the provider — shown on the
        // config screen. Both redirect flows (oauth, auto-discovered mcp) use it.
        redirectUri:
          kind === "oauth" || kind === "mcp"
            ? `${serverBaseUrl()}/oauth/${record.name}/callback`
            : undefined,
        // Ready to connect: docker needs the daemon+image; an mcp integration
        // needs a server URL, plus — when it uses a pre-registered client (has
        // config fields, e.g. HubSpot) rather than dynamic registration — the
        // admin's stored client secret; the rest need the admin's stored secret.
        configured:
          kind === "docker"
            ? dockerSandboxEnabled()
            : kind === "mcp"
              ? Boolean(record.mcpUrl || type?.defaultMcpUrl) &&
                ((type?.configFields.length ?? 0) === 0 ||
                  credentials.orgSecret(record.name) !== undefined)
              : credentials.orgSecret(record.name) !== undefined,
        connected:
          (kind === "oauth" || kind === "mcp") && credentials.hasUserToken(tenantId, record.name),
        // Connected but the provider last rejected the token (a 401): the UI
        // shows "reconnect" rather than a silent "connected" that fails on use.
        stale: (kind === "oauth" || kind === "mcp") && credentials.isStale(tenantId, record.name),
      }
    })
}

/**
 * Record that a provider rejected a user's stored token for an integration (a
 * 401 at call time), so the catalog reads it as "needs reconnect". A no-op for
 * an integration the user has not connected. Called from the MCP call path.
 */
export function markIntegrationStale(
  name: string,
  tenantId: string,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): void {
  credentials.markStale(tenantId, name)
}

/** Clear a stale mark after a call succeeds — the token is working again. */
export function clearIntegrationStale(
  name: string,
  tenantId: string,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): void {
  credentials.clearStale(tenantId, name)
}

/** Whether a given name is a registered integration instance. */
export function isIntegration(name: string): boolean {
  return getIntegrationStore().get(name) !== undefined
}

/**
 * The calling user's usable bearer token for an integration instance, or
 * undefined when they have not connected it (or its type cannot supply one).
 * This is the "auth = integrations" resolution the MCP toolsets use per caller.
 */
export async function integrationBearer(
  name: string,
  tenantId: string,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): Promise<string | undefined> {
  const integration = getIntegration(name)
  if (!integration) return undefined

  // A service account is org-wide (not per-user): mint a token from the stored
  // service account JSON, the same for every caller.
  if (integration.kind === "gcp") {
    const serviceAccount = credentials.orgSecret(name)
    if (!serviceAccount) return undefined
    return await serviceAccountAccessToken(serviceAccount, integration.scopes)
  }

  // A token integration is a single org-wide API bearer (e.g. Firecrawl): the
  // stored org secret IS the bearer, used as-is for every caller.
  if (integration.kind === "token") {
    return credentials.orgSecret(name)
  }

  // An auto-discovered MCP integration (Notion, Sentry): the caller's connected
  // account holds a refresh token; mint a fresh access token from it per call.
  if (integration.kind === "mcp") {
    return rotating(name, tenantId, credentials, mcpAccessToken)
  }

  // An OAuth integration whose tokens expire and rotate (GitHub, when the app
  // issues expiring tokens) — same refresh-and-store path, with the admin's app
  // config passed along so the type can authenticate the refresh grant.
  const rotatingBearer = integration.rotatingBearer
  if (rotatingBearer) {
    return rotating(name, tenantId, credentials, (secret) =>
      rotatingBearer(secret, credentials.orgSecret(name)),
    )
  }

  if (!integration.bearer) return undefined
  const secret = credentials.userToken(tenantId, name)
  if (!secret) return undefined // the caller has not connected this integration
  return await integration.bearer(secret, credentials.orgSecret(name))
}

/**
 * Mint a bearer from the caller's stored credential through a `mint` that may
 * refresh it, and persist the replacement when it does.
 *
 * The whole read-refresh-write runs under a per-credential lock, and the secret
 * is read *inside* it: a provider that rotates refresh tokens revokes the old
 * one on every refresh (Notion's invalid_grant, GitHub's bad_refresh_token), so
 * two concurrent tool calls must not both refresh from the same stored
 * credential. The second one instead reads what the first just stored and finds
 * a valid access token to reuse.
 */
function rotating(
  name: string,
  tenantId: string,
  credentials: ToolCredentialStore,
  mint: (secret: string) => Promise<{ accessToken?: string; rotatedSecret?: string }>,
): Promise<string | undefined> {
  return withRefreshLock(`${name} ${tenantId}`, async () => {
    const secret = credentials.userToken(tenantId, name)
    if (!secret) return undefined // the caller has not connected this integration
    const { accessToken, rotatedSecret } = await mint(secret)
    if (rotatedSecret) {
      credentials.put(tenantId, { scope: "user", tool: name, secret: rotatedSecret })
    }
    return accessToken
  })
}

/**
 * The raw stored secret for an integration instance — the org-wide one (a GCP
 * service-account JSON, a token integration's bearer) when there is one, else
 * the caller's own connected secret. For a plugin toolset that needs the
 * credential itself rather than a minted bearer (`integrationBearer`).
 */
export function integrationSecret(
  name: string,
  tenantId: string,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): string | undefined {
  if (!getIntegration(name)) return undefined
  return credentials.orgSecret(name) ?? credentials.userToken(tenantId, name)
}
