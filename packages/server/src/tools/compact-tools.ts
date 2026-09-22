import { type FlueHarness, defineTool, useInstruction, useSandbox, useTool } from "@flue/runtime"
import { toJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"
import type { AttentionStore } from "../coordinator/attention.ts"
import { getAttentionStore } from "../coordinator/attention.ts"
import { singleUserMode } from "../core/config.ts"
import { getTeamStore } from "../coordinator/teams.ts"
import type { ToolCredentialStore } from "../coordinator/tool-credentials.ts"
import { invokeGated } from "./confirm-gate.ts"
import { grantIntegration } from "./mcp.ts"
import { type ResolvedTool, type ToolContext, resolveGrantedTools } from "./registry.ts"
import { resolveToolsetContributions } from "./toolset-types.ts"

/**
 * The compact tool gateway — the prompt-shortening.
 *
 * Built-in tools (jobs, files, memory, schedules, skills, search, ask, attention)
 * are always mounted in full. Every *other* tool an agent is granted — the
 * credential-backed catalog (firecrawl_scrape, …) and the tools of any granted
 * MCP server — is not mounted as its own Flue tool. Mounting each
 * would put a dozen full JSON schemas into the system prompt on every turn.
 *
 * Instead they are listed one line each and reached through two meta-tools:
 * `describe_tool` (fetch a tool's full input schema on demand — for MCP, live
 * from the server) and `call_tool` (dispatch to the named tool). Every source —
 * a local catalog tool, an MCP tool, a plugin toolset's tool — presents as one
 * `CompactEntry`, so the two meta-tools do not care which is which. The entries
 * for toolset grants are built by the toolset-type registry (`toolset-types.ts`).
 */
export interface CompactEntry {
  /** The name the agent uses. Local: the tool name. MCP: `server/tool`. */
  name: string
  description: string
  /** A gated entry suspends for operator approval instead of running. */
  needsApproval: boolean
  /** The tool's input as JSON Schema, fetched on demand. */
  describe(): Promise<unknown> | unknown
  /**
   * Validate + run, returning the tool's text output. `harness` is the live
   * agent environment, forwarded from `call_tool`; a plugin tool declaring
   * `harness: true` needs it to reach `harness.sandbox`. Local and MCP entries
   * ignore it.
   */
  call(
    args: Record<string, unknown>,
    signal?: AbortSignal,
    harness?: FlueHarness,
  ): Promise<string> | string
}

export function attachCompactTools(
  grants: readonly string[],
  base: Omit<ToolContext, "credential">,
  credentials?: ToolCredentialStore,
  attention: AttentionStore = getAttentionStore(),
): void {
  // A single-user server has no teams to manage: its one account may use every
  // toolset its agents are granted.
  const permitted = singleUserMode() ? [...grants] : teamPermitted(grants, base.tenantId)

  // Toolset grants (mcp / sandbox / a plugin kind) resolve through the registry:
  // it yields compact entries to list, and at most one sandbox factory. The
  // sandbox is attached here, in the render frame — a granted sandbox stands
  // even when the agent has no compact tools at all.
  const { entries: toolsetEntries, sandbox } = resolveToolsetContributions(permitted, {
    base,
    attention,
  })
  if (sandbox) useSandbox(sandbox)

  const entries = [
    ...resolveGrantedTools(permitted, base, credentials).map((tool) => localEntry(tool, attention)),
    ...toolsetEntries,
  ]
  if (entries.length === 0) return

  const byName = new Map(entries.map((entry) => [entry.name, entry]))
  const catalog = entries.map((entry) => `- ${entry.name} — ${entry.description}`).join("\n")
  useInstruction(
    `## Extra tools

Beyond your built-in tools you have the tools below, listed compactly to keep this prompt short. Their inputs are not shown here. To use one:

1. Call \`describe_tool\` with its name to get its input schema.
2. Call \`call_tool\` with the name and an \`arguments\` object matching that schema.

${catalog}`,
  )

  useTool(
    defineTool({
      name: "describe_tool",
      description:
        "Get the full input schema of one of your extra tools, so you can call it with call_tool.",
      input: v.object({ tool: v.string() }),
      run: ({ data }) => describeTool(byName, data.tool),
    }),
  )

  useTool(
    defineTool({
      name: "call_tool",
      description:
        "Run one of your extra tools by name. Call describe_tool first to see its inputs, then pass them as arguments.",
      input: v.object({
        tool: v.string(),
        arguments: v.optional(v.record(v.string(), v.unknown()), {}),
      }),
      // `harness: true` so a plugin toolset's tool can reach the live sandbox
      // (`harness.sandbox`) — it runs behind this gateway, not as its own Flue
      // tool, so this is its only path to the agent's environment.
      harness: true,
      run: ({ data, signal, harness }) =>
        callTool(byName, data.tool, data.arguments, signal, harness),
    }),
  )
}

/**
 * Teams gate which toolsets the owner's agents may use: an agent is offered
 * only the toolsets it is granted AND some team the owner is on also grants.
 * A second gate applies to a toolset backed by an integration — that
 * integration must also be granted to one of the owner's teams. A user on no
 * team gets none (the restrictive default). Built-in tools are attached
 * elsewhere and never gated.
 */
function teamPermitted(grants: readonly string[], tenantId: string): string[] {
  const teamStore = getTeamStore()
  const allowed = teamStore.grantedToolsets(tenantId)
  const allowedIntegrations = teamStore.grantedIntegrations(tenantId)
  return grants.filter((grant) => {
    if (!allowed.has(grant)) return false
    const integration = grantIntegration(grant)
    return integration === undefined || allowedIntegrations.has(integration)
  })
}

/** A resolved set of compact tools, keyed by name — what the meta-tools dispatch over. */
export type CompactTools = Map<string, CompactEntry>

/** `describe_tool`: the named tool's full input schema, or a helpful miss. */
export async function describeTool(byName: CompactTools, name: string): Promise<string> {
  const entry = byName.get(name)
  if (!entry) return unknownTool(name, byName)
  try {
    return JSON.stringify(
      {
        tool: entry.name,
        description: entry.description,
        needsApproval: entry.needsApproval,
        input: await entry.describe(),
      },
      null,
      2,
    )
  } catch (caught) {
    return `Could not read the schema for ${name}: ${messageOf(caught)}`
  }
}

/**
 * `call_tool`: dispatch to the named tool. Each entry validates and runs itself
 * (a local tool validates against its valibot schema and passes the confirm-gate;
 * an MCP tool calls the server). A thrown error becomes text, so a failing tool
 * does not sink the whole turn.
 */
export async function callTool(
  byName: CompactTools,
  name: string,
  args: Record<string, unknown> | undefined,
  signal?: AbortSignal,
  harness?: FlueHarness,
): Promise<string> {
  const entry = byName.get(name)
  if (!entry) return unknownTool(name, byName)
  try {
    return await entry.call(args ?? {}, signal, harness)
  } catch (caught) {
    return `${name} failed: ${messageOf(caught)}`
  }
}

/** Wrap a granted local catalog tool (valibot-validated, confirm-gated) as an entry. */
function localEntry(resolved: ResolvedTool, attention: AttentionStore): CompactEntry {
  return {
    name: resolved.tool.name,
    description: resolved.descriptor.description,
    needsApproval: resolved.descriptor.gated,
    describe: () =>
      resolved.tool.input
        ? toJsonSchema(resolved.tool.input as v.GenericSchema)
        : { type: "object", properties: {} },
    call: (args) => {
      let payload: unknown = args
      if (resolved.tool.input) {
        const result = v.safeParse(resolved.tool.input as v.GenericSchema, args)
        if (!result.success) {
          const issues = result.issues
            .map((issue) => {
              const path = issue.path?.map((segment) => String(segment.key)).join(".")
              return path ? `${path}: ${issue.message}` : issue.message
            })
            .join("; ")
          return `Invalid arguments for ${resolved.tool.name}: ${issues}. Call describe_tool("${resolved.tool.name}") to see the expected inputs.`
        }
        payload = result.output
      }
      return invokeGated(
        resolved.descriptor.gated,
        resolved.context,
        resolved.tool.name,
        payload,
        resolved.tool.run,
        attention,
      )
    },
  }
}

/** The "no such tool" reply, listing what the agent does have. */
function unknownTool(name: string, byName: CompactTools): string {
  return `No tool named "${name}". Your extra tools are: ${[...byName.keys()].join(", ")}.`
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}
