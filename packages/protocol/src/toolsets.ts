import { z } from "zod"

/**
 * Toolsets — the "which tools do I want enabled" layer, and the only way an
 * agent gets tools. A toolset names an `integration` (auth/environment). Two
 * kinds live in this table:
 *
 * - `mcp` — the tools an admin selected from an MCP server (`url` + `tools`),
 *   authorized by the integration's per-user token. Granted as `mcp:<name>`.
 * - `sandbox` — a Docker sandbox toolset backed by a Docker Sandbox integration
 *   (its repos). Its tools are the built-in read/write/edit/bash/grep/glob set
 *   Flue supplies; there is nothing to select. Granted as `sandbox:<name>`.
 *
 * Built-in toolsets (Firecrawl) are code-defined and not rows here. Every
 * toolset is org-wide config (no per-tenant row).
 */

export const ToolsetName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, digits, and hyphens only")

export const McpTransport = z.enum(["streamable-http", "sse"])
export type McpTransport = z.infer<typeof McpTransport>

/**
 * A toolset's kind. `mcp` and `sandbox` are built in; a plugin can register
 * more (see `@staffroom/plugin-core`), so this is an open slug rather than a
 * closed enum. The server validates a kind against its toolset-type registry
 * (built-ins + plugin kinds) when a toolset is created — the protocol only
 * bounds its shape.
 */
export const ToolsetKind = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, "use lowercase letters, digits, and hyphens only")
export type ToolsetKind = z.infer<typeof ToolsetKind>

export const Toolset = z.object({
  name: ToolsetName,
  /** A friendly display name for the toolset (e.g. "Gmail read-only"). */
  label: z.string().min(1),
  kind: ToolsetKind.default("mcp"),
  /**
   * The integration this toolset authenticates/mounts through — an MCP OAuth
   * app, or a Docker Sandbox. Required for kinds that use one (mcp, sandbox);
   * empty for a plugin kind that authenticates its own way (e.g. from env). The
   * route enforces it per kind via the kind's `usesIntegration`.
   */
  integration: z.string().default(""),
  /** The MCP server URL (mcp kind only). */
  url: z.string().url().optional(),
  transport: McpTransport.optional(),
  /** The tools an admin has enabled (mcp kind); empty for sandbox. */
  tools: z.array(z.string().min(1)).default([]),
  /**
   * The enabled tools that require operator approval before each call (a subset
   * of `tools`) — outbound or irreversible ones the admin wants confirm-gated.
   */
  gatedTools: z.array(z.string().min(1)).default([]),
  /** One-line descriptions cached at save time, for the compact catalog. */
  toolDescriptions: z.record(z.string(), z.string()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Toolset = z.infer<typeof Toolset>

export const ToolsetInput = Toolset.pick({
  name: true,
  label: true,
  kind: true,
  integration: true,
  url: true,
  transport: true,
  tools: true,
  gatedTools: true,
  toolDescriptions: true,
})
export type ToolsetInput = z.infer<typeof ToolsetInput>

/** What the discovery call needs to connect and list a server's tools. */
export const McpDiscoveryInput = z.object({
  url: z.string().url(),
  transport: McpTransport,
  integration: z.string().min(1),
})
export type McpDiscoveryInput = z.infer<typeof McpDiscoveryInput>

export const McpDiscoveredTool = z.object({
  name: z.string(),
  description: z.string(),
})
export type McpDiscoveredTool = z.infer<typeof McpDiscoveredTool>

/**
 * A registered toolset kind, for the "add toolset" UI. Built-in kinds (`mcp`,
 * `sandbox`) have bespoke forms (`builtinForm: true`); a plugin kind uses the
 * generic form, which shows a URL and/or an integration picker per the flags.
 */
export const ToolsetKindInfo = z.object({
  kind: z.string(),
  label: z.string(),
  description: z.string(),
  usesUrl: z.boolean(),
  usesIntegration: z.boolean(),
  builtinForm: z.boolean(),
})
export type ToolsetKindInfo = z.infer<typeof ToolsetKindInfo>
