import type { IntegrationTypeDef } from "@staffroom/plugin-core"

/**
 * Example 2 — a plugin INTEGRATION TYPE.
 *
 * An integration type is a provider an admin registers an app of, in Settings →
 * Integrations. It merges into the same registry as the built-ins (Google,
 * Slack, GCP, Firecrawl, Docker), so a plugin provider is connectable and
 * grantable through the ordinary UI.
 *
 * This one is the simplest shape, `token`: a single org-wide API bearer, like
 * Firecrawl. An admin pastes the key once; it becomes the org secret for the
 * instance. Because it is a token integration, the server hands that key back as
 * the bearer for any MCP toolset that names this integration — so pair it with
 * an MCP toolset (a built-in kind) and its tools authenticate automatically.
 * Set `defaultMcpUrl` if the provider has a hosted MCP server, and the MCP
 * toolset form prefills it.
 */
export const acmeIntegration: IntegrationTypeDef = {
  type: "acme",
  kind: "token",
  label: "Acme",
  description:
    "Acme's hosted API, via its MCP server. Paste your Acme API key; add an MCP toolset that names this integration and its tools authenticate with the key. The key is org-wide — who may use it is decided by teams.",
  // Each field the connect form renders. `secret` fields are write-only.
  configFields: [{ key: "apiKey", label: "API key", secret: true, optional: false }],
  defaultScopes: [],
  unlocks: ["Acme"],
  // If Acme published a hosted MCP endpoint, prefill it here:
  // defaultMcpUrl: "https://mcp.acme.example/v1/mcp",
}

/**
 * The other shapes, for reference (the built-ins are the worked examples):
 *
 * - `oauth`  — an admin registers an app (clientId/secret) and each person
 *   connects their own account. Supply an `oauth` object with `buildAuthUrl`
 *   and `exchange`, and a `bearer` that turns the stored per-user secret into an
 *   access token. See `packages/server/src/integrations.ts` (GOOGLE, SLACK).
 * - `gcp`    — one org-wide service-account key, minted into a short-lived token.
 * - `docker` — the Docker Sandbox provider (repos to mount); no secret.
 */
