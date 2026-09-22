import { z } from "zod"
import { ConfigField } from "./tools.ts"

/**
 * Integrations — an OAuth **app** an admin registers, that people then connect
 * their own account to. There are a fixed set of **types** (Google, Slack) and
 * any number of **instances** of each: two Slack apps with different scopes,
 * say, so a low-permission toolset and a high-permission one can each name the
 * app that matches. A toolset references an instance by its slug `name`.
 */

/** A slug — the reference/grant key an instance is known by. */
export const IntegrationName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits, and hyphens only")

/**
 * An integration's kind decides its config shape: `oauth` (client id/secret +
 * scopes + per-user connect), `mcp` (an MCP server URL whose OAuth endpoints are
 * auto-discovered, with a per-user PKCE connect — the client is either registered
 * dynamically with no app to set up by hand, e.g. Notion/Sentry, or pre-registered
 * as an admin-supplied client id/secret when the server has no dynamic
 * registration, e.g. HubSpot), `docker` (a list of repos to mount, no OAuth),
 * `gcp` (a service account JSON minted into a token), or `token` (a single
 * org-wide API bearer token, used as-is — e.g. Firecrawl).
 */
export const IntegrationKind = z.enum(["oauth", "mcp", "docker", "gcp", "token"])
export type IntegrationKind = z.infer<typeof IntegrationKind>

/** A repo a Docker Sandbox mounts read-only: a mount name and a local git path. */
export const SandboxRepoInput = z.object({
  name: IntegrationName,
  path: z.string().min(1),
})
export type SandboxRepoInput = z.infer<typeof SandboxRepoInput>

/** A registerable type, for the "add integration" picker. */
export const IntegrationTypeInfo = z.object({
  type: z.string(),
  kind: IntegrationKind,
  label: z.string(),
  description: z.string(),
  /** The org app-config fields (client id, secret). Empty for docker. */
  configFields: z.array(ConfigField),
  /** The scopes an oauth instance requests by default; editable per instance. */
  defaultScopes: z.array(z.string()),
  unlocks: z.array(z.string()),
  /** A default MCP server URL an MCP toolset can prefill (e.g. Firecrawl). */
  defaultMcpUrl: z.string().optional(),
})
export type IntegrationTypeInfo = z.infer<typeof IntegrationTypeInfo>

/** A configured instance, as the UI sees it. */
export const IntegrationInstance = z.object({
  name: z.string(),
  kind: IntegrationKind,
  label: z.string(),
  type: z.string(),
  scopes: z.array(z.string()),
  /** The repos a docker instance mounts; empty for oauth. */
  repos: z.array(SandboxRepoInput),
  description: z.string(),
  configFields: z.array(ConfigField),
  unlocks: z.array(z.string()),
  /**
   * The effective MCP server URL an MCP toolset prefills (token kind) — the
   * instance's own URL if set, else the type's default. Empty when neither.
   */
  mcpUrl: z.string().optional(),
  /**
   * The OAuth redirect URI to register with the provider (oauth kind only) —
   * `<server base url>/oauth/<name>/callback`. Computed server-side from
   * `STAFFROOM_URL`, so the config screen shows the exact value the server sends
   * rather than guessing from the browser origin. Absent for non-oauth kinds.
   */
  redirectUri: z.string().optional(),
  /** oauth: an admin set the app config. docker: the daemon + image are ready. */
  configured: z.boolean(),
  /** Whether the current user has connected their own account (oauth only). */
  connected: z.boolean(),
  /**
   * Connected, but the provider last rejected the stored token (a 401): the
   * account needs reconnecting. Always false when not connected.
   */
  stale: z.boolean(),
})
export type IntegrationInstance = z.infer<typeof IntegrationInstance>

/**
 * Create or update an instance. `clientId`/`clientSecret` (oauth) are optional
 * so an edit can change scopes/label without re-entering the secret; `repos`
 * (docker) replaces the whole list. Which fields matter is decided by the type.
 */
export const IntegrationInput = z.object({
  name: IntegrationName,
  label: z.string().min(1),
  type: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  repos: z.array(SandboxRepoInput).default([]),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  /** The service account JSON, for a gcp instance. Optional on edit (kept if absent). */
  serviceAccount: z.string().min(1).optional(),
  /** The API bearer token, for a token instance. Optional on edit (kept if absent). */
  apiKey: z.string().min(1).optional(),
  /** A custom MCP server URL (token instance); empty falls back to the type default. */
  mcpUrl: z.string().default(""),
})
export type IntegrationInput = z.infer<typeof IntegrationInput>
