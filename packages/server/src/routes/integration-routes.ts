import { zValidator } from "@hono/zod-validator"
import { IntegrationInput } from "@staffroom/protocol"
import { Hono } from "hono"
import type { Context } from "hono"
import { z } from "zod"
import { serverBaseUrl } from "../core/config.ts"
import { getIntegrationStore } from "../coordinator/integrations.ts"
import { putOAuthState } from "../coordinator/oauth-state.ts"
import { startMcpOAuth } from "../core/mcp-oauth.ts"
import { getToolCredentialStore } from "../coordinator/tool-credentials.ts"
import {
  getIntegration,
  getIntegrationType,
  integrationCatalog,
  integrationTypes,
} from "../core/integrations.ts"
import { sandboxImageStatus, startSandboxImageBuild } from "../tools/docker-sandbox.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Integrations — registerable OAuth apps and the per-user connect.
 *
 * An admin registers **instances** of a type (two Slack apps with different
 * scopes, say); registering and editing is admin-only, connecting is per user.
 * An instance's metadata (label, type, scopes) lives in the integrations store;
 * its client id/secret and each person's token live in the tool credential
 * store, keyed by the instance slug. Secrets are write-only.
 *
 * Mounted at `/api/integrations`, so the paths here are relative — that keeps
 * the type (`IntegrationRoutes`) clean for the Hono RPC client. The handlers are
 * chained (RPC infers the client from the chain) and validated with
 * `zValidator` (the input types the client sees).
 */
const nameParam = z.object({ name: z.string() })

/** Parse a stored app config (`{ clientId, clientSecret }`). */
function appConfig(name: string): { clientId: string; clientSecret: string } | undefined {
  const secret = getToolCredentialStore().orgSecret(name)
  if (!secret) return undefined
  try {
    const parsed = JSON.parse(secret) as { clientId?: string; clientSecret?: string }
    if (!parsed.clientId || !parsed.clientSecret) return undefined
    return { clientId: parsed.clientId.trim(), clientSecret: parsed.clientSecret.trim() }
  } catch {
    return undefined
  }
}

/** Registering and editing instances is admin-only; connecting is per user. */
async function adminOnly(context: Context<SessionEnv>, next: () => Promise<void>) {
  if (context.get("caller").role !== "admin") return context.json({ error: "admin_required" }, 403)
  await next()
}

/**
 * Register or update an instance: persist its metadata plus, when supplied, the
 * app config. Rewrite the stored secret only when supplied, so an edit that just
 * changes scopes/label/repos keeps the existing secret. oauth stores { clientId,
 * clientSecret }; gcp stores the service account JSON; token stores the bare API
 * bearer; docker stores nothing.
 */
function persist(context: Context<SessionEnv>, data: z.infer<typeof IntegrationInput>) {
  if (!getIntegrationType(data.type)) return context.json({ error: "unknown_type" }, 400)
  const { clientId, clientSecret, serviceAccount, apiKey, ...metadata } = data
  const store = getToolCredentialStore()
  if (clientId && clientSecret) {
    store.put(null, {
      scope: "org",
      tool: metadata.name,
      secret: JSON.stringify({ clientId, clientSecret }),
    })
  } else if (serviceAccount) {
    store.put(null, { scope: "org", tool: metadata.name, secret: serviceAccount })
  } else if (apiKey) {
    store.put(null, { scope: "org", tool: metadata.name, secret: apiKey })
  }
  return context.json({ integration: getIntegrationStore().put(metadata) })
}

export const integrationRoutes = new Hono<SessionEnv>()
  .get("/", (context) =>
    context.json({ integrations: integrationCatalog(context.get("caller").tenantId) }),
  )
  // The registerable types, for the "add integration" picker.
  .get("/types", (context) => context.json({ types: integrationTypes() }))
  .post(
    "/",
    adminOnly,
    zValidator("json", IntegrationInput, (result, context) => {
      if (!result.success)
        return context.json({ error: "invalid_input", issues: result.error.issues }, 400)
    }),
    (context) => persist(context, context.req.valid("json")),
  )
  .put(
    "/:name",
    adminOnly,
    zValidator("param", nameParam),
    zValidator("json", IntegrationInput, (result, context) => {
      if (!result.success)
        return context.json({ error: "invalid_input", issues: result.error.issues }, 400)
    }),
    // The slug is taken from the path, not the body.
    (context) =>
      persist(context, { ...context.req.valid("json"), name: context.req.valid("param").name }),
  )
  .delete("/:name", adminOnly, zValidator("param", nameParam), (context) => {
    const { name } = context.req.valid("param")
    getToolCredentialStore().removeOrg(name)
    return context.json({ removed: getIntegrationStore().remove(name) })
  })
  // The Docker sandbox runtime behind docker-kind instances: is the daemon up,
  // is the image built, and how a running build is going. Anyone may look;
  // building is admin-only (it runs `docker build` on the server). The card
  // polls this while a build runs.
  .get("/sandbox/status", async (context) => context.json({ status: await sandboxImageStatus() }))
  .post("/sandbox/build", adminOnly, (context) => context.json({ build: startSandboxImageBuild() }))
  // Begin the per-user connect for an instance. Returns the consent URL, built
  // with the instance's own scopes so different apps of a type request the
  // permissions each is configured for. The redirect URI points at the server.
  .get(
    "/:name/connect",
    zValidator("param", nameParam),
    zValidator("query", z.object({ origin: z.string() }), (result, context) => {
      if (!result.success) return context.json({ error: "origin_required" }, 400)
    }),
    async (context) => {
      const { tenantId } = context.get("caller")
      const { name } = context.req.valid("param")
      const integration = getIntegration(name)
      const origin = context.req.valid("query").origin
      if (!origin) return context.json({ error: "origin_required" }, 400)
      const redirectUri = `${serverBaseUrl()}/oauth/${name}/callback`

      // An MCP integration: discover the server's OAuth endpoints and build the
      // PKCE consent URL. Notion/Sentry have no config fields — a client is
      // registered dynamically. HubSpot has config fields (an MCP auth app): pass
      // its pre-registered client id/secret instead, and require it first.
      // Discovery can fail (network, bad metadata), so it is reported rather than
      // thrown into a 500.
      if (integration?.kind === "mcp") {
        if (!integration.mcpUrl) return context.json({ error: "not_configured" }, 409)
        const needsClient = integration.configFields.length > 0
        const client = needsClient ? appConfig(name) : undefined
        if (needsClient && !client) return context.json({ error: "not_configured" }, 409)
        const state = putOAuthState(tenantId, origin)
        try {
          const { authorizationUrl } = await startMcpOAuth({
            url: integration.mcpUrl,
            redirectUri,
            state,
            client,
          })
          return context.json({ authUrl: authorizationUrl })
        } catch (caught) {
          console.error(`[oauth] ${name} discovery failed:`, caught)
          const message = caught instanceof Error ? caught.message : "Discovery failed."
          return context.json({ error: "discovery_failed", message }, 502)
        }
      }

      if (!integration?.oauth) return context.json({ error: "not_oauth" }, 404)
      const config = appConfig(name)
      if (!config) return context.json({ error: "not_configured" }, 409)

      const state = putOAuthState(tenantId, origin)
      const authUrl = integration.oauth.buildAuthUrl(config, redirectUri, state, integration.scopes)
      return context.json({ authUrl })
    },
  )
  // Disconnect the caller's own account for an instance (remove their token).
  .delete("/:name/connection", zValidator("param", nameParam), (context) => {
    const { tenantId } = context.get("caller")
    const { name } = context.req.valid("param")
    const store = getToolCredentialStore()
    const token = store.list(tenantId).find((c) => c.tool === name && c.scope === "user")
    if (token) store.remove(tenantId, token.id)
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<IntegrationRoutes>`). */
export type IntegrationRoutes = typeof integrationRoutes
