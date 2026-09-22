import { z } from "zod"
import { TenantId } from "./identity.ts"

/**
 * The tool catalog.
 *
 * Tool *implementations* are code; what the organization configures is which
 * tools exist, how they authenticate, and whether they need a confirm-gate.
 *
 * Real integrations do not fit a single org/per-user axis, so a tool declares
 * its **provisioning shape** — how a usable credential is assembled from an
 * org-level part and a per-user part:
 *
 * - `none` — no credential. Either always available (the clock) or gated by a
 *   runtime probe the descriptor supplies (Docker: is the daemon up).
 * - `org-key` — one shared org secret runs it for everyone (Firecrawl).
 * - `user-key` — each person supplies their own token, no org config and no
 *   OAuth dance. (No built-in example yet; kept because a tool that just needs
 *   a personal API key is a real shape.)
 * - `oauth` — an admin provides the app config (clientId/secret) once, and each
 *   person then OAuths their own token against it (Gmail, Calendar, Slack). Two
 *   parts, both required; the per-user part is stored as a refresh token.
 * - `org-key-user-grant` — a shared org secret, but usable only by people an
 *   admin has granted access to (GCP: one service account, per-user allow).
 *
 * The rule every shape serves: a tool is offered to an agent only when its
 * owner has everything it needs, so an agent never sees a tool it could only
 * fail with.
 *
 * **MCP servers are a separate family.** Sentry, Notion and other MCP tools are
 * reached through the MCP gateway, not as catalog descriptors, and authenticate
 * with per-user OAuth whose endpoints the MCP server advertises (an automatic
 * grant flow — you are sent to the server, you consent, you return with a
 * token). That gateway is a deferred verbatim lift; its per-user token storage
 * is the same shape as `oauth` here, only with discovered endpoints rather than
 * admin-configured ones.
 */
export const ToolProvisioning = z.enum([
  "none",
  "org-key",
  "user-key",
  "oauth",
  "org-key-user-grant",
])

/**
 * The two questions the registry answers from a provisioning shape: does an
 * org-level secret have to be configured, and what must each user do.
 */
export interface ProvisioningSpec {
  /** An admin must configure an org secret (a shared key, or OAuth app config). */
  orgSecret: boolean
  /** What each user needs before the tool is theirs to use. */
  perUser: "none" | "token" | "grant"
}

export function provisioningSpec(provisioning: ToolProvisioning): ProvisioningSpec {
  switch (provisioning) {
    case "none":
      return { orgSecret: false, perUser: "none" }
    case "org-key":
      return { orgSecret: true, perUser: "none" }
    case "user-key":
      return { orgSecret: false, perUser: "token" }
    case "oauth":
      return { orgSecret: true, perUser: "token" }
    case "org-key-user-grant":
      return { orgSecret: true, perUser: "grant" }
  }
}

/** A catalog entry as a client sees it. The secret never appears. */
/**
 * One field of a tool's org configuration. A tool with more than a bare API key
 * (Firecrawl's instance URL, Gmail's client id + secret) declares its fields;
 * the connect form renders them, and the values are stored together as the org
 * secret (a JSON map). A tool that needs only a single key declares one field.
 */
export const ConfigField = z.object({
  key: z.string(),
  label: z.string(),
  /** Render as a password input, and never echo it back. */
  secret: z.boolean().default(false),
  optional: z.boolean().default(false),
  placeholder: z.string().optional(),
})

export const ToolCatalogEntry = z.object({
  name: z.string(),
  /** A friendly display name — the toolset's title (e.g. "Firecrawl"). */
  label: z.string(),
  description: z.string(),
  provisioning: ToolProvisioning,
  /**
   * Whether calling it needs operator confirmation (M7). Outbound and
   * irreversible tools — sending mail, deleting, spending — are gated.
   */
  gated: z.boolean(),
  /** The org-config fields the connect form should render. Empty for most. */
  configFields: z.array(ConfigField).default([]),
})

/**
 * A stored tool credential, as a client sees it — a label and a hint, no
 * secret. `grant` rows carry no secret at all: they record that a user may use
 * an org-level credential.
 */
export const ToolCredential = z.object({
  id: z.string(),
  tool: z.string(),
  scope: z.enum(["org", "user", "grant"]),
  /** Null for an org credential. */
  tenantId: TenantId.nullable(),
  hint: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ToolCredentialInput = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("org"), tool: z.string().min(1), secret: z.string().min(1) }),
  z.object({ scope: z.literal("user"), tool: z.string().min(1), secret: z.string().min(1) }),
  // A grant carries no secret — an admin is recording that a user may use the
  // org credential (GCP). The route checks the admin role.
  z.object({ scope: z.literal("grant"), tool: z.string().min(1), user: TenantId }),
])

export type ToolProvisioning = z.infer<typeof ToolProvisioning>
export type ConfigField = z.infer<typeof ConfigField>
export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntry>
export type ToolCredential = z.infer<typeof ToolCredential>
export type ToolCredentialInput = z.infer<typeof ToolCredentialInput>
