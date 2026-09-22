import { useTool } from "@flue/runtime"
import {
  type ConfigField,
  type ToolCatalogEntry,
  type ToolProvisioning,
  provisioningSpec,
} from "@staffroom/protocol"
import {
  type ToolCredentialStore,
  getToolCredentialStore,
} from "../coordinator/tool-credentials.ts"

/**
 * The catalog of tools an agent can be granted.
 *
 * A tool implementation is code; the catalog is the metadata around it — how it
 * authenticates (its provisioning shape), whether it needs a confirm-gate — and
 * the factory that builds the Flue tool for one render, bound with the caller's
 * identity and the resolved credential. Flue does not tell a tool who called
 * it, so binding at render time is the only place the tenant and the credential
 * can be attached.
 */
export interface ResolvedCredential {
  /** The shared org secret, for org-key / oauth / org-key-user-grant tools. */
  orgSecret?: string
  /** The user's own token, for user-key / oauth tools. */
  userToken?: string
}

export interface ToolContext {
  tenantId: string
  agent: string
  session: string
  jobId?: number
  credential: ResolvedCredential
}

export interface ToolDescriptor {
  name: string
  /** A friendly toolset title (e.g. "Firecrawl"). Defaults to the name. */
  label?: string
  description: string
  provisioning: ToolProvisioning
  /** Outbound or irreversible: calling it needs operator confirmation (M7). */
  gated: boolean
  /**
   * The org-config fields the connect form renders. A tool with more than a
   * single key (Firecrawl's URL + key) declares them; their values are stored
   * together as the org secret, a JSON map. Absent means one plain secret.
   */
  configFields?: ConfigField[]
  /**
   * The integration a credential-backed tool belongs to (`google`). When set,
   * the org config and the per-user token are keyed off the integration, not
   * the tool — so a family of tools can share one app config and one per-user
   * connection. Absent means the tool owns its own credential.
   */
  integration?: string
  /**
   * A runtime availability probe, for tools whose usability is not a stored
   * credential (Docker: is the daemon up). Absent means always available.
   */
  available?: () => boolean
  /** Build the Flue tool for one render. `attach` is passed so M7 can wrap it. */
  build(context: ToolContext, attach: (tool: unknown) => void): void
}

// Built-in credential-backed tools. Firecrawl moved out to a `token`
// integration + MCP toolset, so this is currently empty; add descriptors here
// to reintroduce a built-in credentialed tool.
const DESCRIPTORS: Map<string, ToolDescriptor> = new Map()

/** The catalog, for the settings screen. */
export function toolCatalog(): ToolCatalogEntry[] {
  return [...DESCRIPTORS.values()].map((descriptor) => ({
    name: descriptor.name,
    label: descriptor.label ?? descriptor.name,
    description: descriptor.description,
    provisioning: descriptor.provisioning,
    gated: descriptor.gated,
    configFields: descriptor.configFields ?? [],
  }))
}

export function toolDescriptor(name: string): ToolDescriptor | undefined {
  return DESCRIPTORS.get(name)
}

/**
 * How a granted tool is attached — the seam M7 wraps to insert the confirm-gate.
 * The default just mounts it.
 */
export type AttachTool = (descriptor: ToolDescriptor, context: ToolContext, tool: unknown) => void

const defaultAttach: AttachTool = (_descriptor, _context, tool) => {
  useTool(tool as Parameters<typeof useTool>[0])
}

/**
 * Attach every tool an agent is granted that it can actually use.
 *
 * The offer-or-not rule lives here and spans every provisioning shape: a tool
 * is skipped when its org secret is not configured, when its per-user token is
 * not connected, when its per-user grant is not given, or when its runtime
 * probe fails. So an agent never sees a tool it could only fail with.
 */
export function attachGrantedTools(
  grants: readonly string[],
  base: Omit<ToolContext, "credential">,
  attach: AttachTool = defaultAttach,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): void {
  for (const name of grants) {
    const descriptor = DESCRIPTORS.get(name)
    if (!descriptor) continue // MCP grants and unknown names are handled elsewhere
    if (descriptor.available && !descriptor.available()) continue

    const credential = resolveToolCredential(descriptor, base.tenantId, credentials)
    if (!credential) continue // missing org secret, token, or grant

    const context: ToolContext = { ...base, credential }
    descriptor.build(context, (tool) => attach(descriptor, context, tool))
  }
}

/**
 * A built Flue tool, captured rather than mounted. `input` is the tool's
 * valibot schema (used to describe and validate it); `run` is its
 * implementation. The shape is deliberately the minimum the compact gateway
 * reads, so it does not depend on Flue's tool internals beyond these fields.
 */
export interface BuiltTool {
  name: string
  description?: string
  input?: unknown
  run: (arg: { data: unknown }) => Promise<string> | string
}

/** A granted tool resolved for one render: its descriptor, bound context, and built tool. */
export interface ResolvedTool {
  descriptor: ToolDescriptor
  context: ToolContext
  tool: BuiltTool
}

/**
 * Resolve every granted catalog tool the agent can actually use, building each
 * one but **capturing** it instead of mounting it. Same offer-or-not rule as
 * {@link attachGrantedTools} — skip an unavailable probe, a missing org secret,
 * an unconnected per-user token or an ungranted per-user tool — so the caller
 * only ever sees tools that would work.
 *
 * The compact gateway uses this to list the tools and dispatch them through one
 * `call_tool`, rather than mounting each as its own Flue tool. That is the
 * prompt-shortening: schemas stay out of context until `describe_tool` asks.
 */
export function resolveGrantedTools(
  grants: readonly string[],
  base: Omit<ToolContext, "credential">,
  credentials: ToolCredentialStore = getToolCredentialStore(),
): ResolvedTool[] {
  const resolved: ResolvedTool[] = []
  for (const name of grants) {
    const descriptor = DESCRIPTORS.get(name)
    if (!descriptor) continue // MCP grants and unknown names are handled elsewhere
    if (descriptor.available && !descriptor.available()) continue

    const credential = resolveToolCredential(descriptor, base.tenantId, credentials)
    if (!credential) continue // missing org secret, token, or grant

    const context: ToolContext = { ...base, credential }
    let built: BuiltTool | undefined
    descriptor.build(context, (tool) => {
      built = tool as BuiltTool
    })
    if (built) resolved.push({ descriptor, context, tool: built })
  }
  return resolved
}

/**
 * Assemble a usable credential for one tool and owner, or undefined when the
 * tool is not usable. Undefined is the offer-or-not decision, and the whole of
 * it: exported so the resolution matrix can be tested across every provisioning
 * shape without a Flue render frame.
 */
export function resolveToolCredential(
  descriptor: ToolDescriptor,
  tenantId: string,
  credentials: ToolCredentialStore,
): ResolvedCredential | undefined {
  const spec = provisioningSpec(descriptor.provisioning)
  const resolved: ResolvedCredential = {}
  // An integration tool shares its org config and per-user token across the
  // whole family, so key them off the integration rather than the tool name.
  const key = descriptor.integration ?? descriptor.name

  if (spec.orgSecret) {
    const orgSecret = credentials.orgSecret(key)
    if (orgSecret === undefined) return undefined
    resolved.orgSecret = orgSecret
  }

  if (spec.perUser === "token") {
    const userToken = credentials.userToken(tenantId, key)
    if (userToken === undefined) return undefined
    resolved.userToken = userToken
  } else if (spec.perUser === "grant") {
    if (!credentials.isGranted(tenantId, key)) return undefined
  }

  return resolved
}
