import type { FlueHarness, SandboxFactory, ToolDefinition } from "@flue/runtime"
import type { ToolsetResolveContext, ToolsetTypeDef } from "@staffroom/plugin-core"
import { pluginToolsetTypes } from "@staffroom/plugin-core"
import type { Toolset, ToolsetKindInfo } from "@staffroom/protocol"
import { toJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"
import type { AttentionStore } from "../coordinator/attention.ts"
import { getToolsetStore } from "../coordinator/toolsets.ts"
import {
  clearIntegrationStale,
  integrationBearer,
  integrationRepos,
  integrationSecret,
  markIntegrationStale,
} from "../core/integrations.ts"
import type { CompactEntry } from "./compact-tools.ts"
import { invokeGated } from "./confirm-gate.ts"
import { dockerSandboxEnabled, dockerSandboxFactory } from "./docker-sandbox.ts"
import { grantToolset } from "./mcp.ts"
import { callMcpTool, describeMcpTool, isMcpAuthError, targetOf } from "./mcp-client.ts"
import type { ToolContext } from "./registry.ts"

/**
 * The toolset-type registry — the render-time dispatch that turns a granted
 * toolset into what the server attaches. It replaces the hand-written
 * `if (kind === "sandbox")` branch that used to live in the agent render.
 *
 * Each kind is a driver keyed by `Toolset.kind`. A built-in driver (mcp,
 * sandbox) runs in the server's own runtime, so it may reference Flue tool
 * builders directly. A plugin driver hands back **plain data** — Flue tool
 * descriptors or a sandbox factory — which the server adapts here; a plugin can
 * never call a render hook itself (see the `@staffroom/plugin-core` header).
 *
 * The grant `<kind>:<name>` names a toolset row; the row's own `kind` is the
 * authority on which driver runs, not the grant prefix.
 */

/** What a granted toolset contributes to one render, in the server's own terms. */
export interface ToolsetResolution {
  entries?: CompactEntry[]
  sandbox?: SandboxFactory
}

/** The render context a driver resolves against. */
export interface ToolsetResolveEnv {
  base: Omit<ToolContext, "credential">
  attention: AttentionStore
}

interface ServerToolsetType {
  kind: string
  /** UI metadata for the "add toolset" picker and the create form. */
  label: string
  description: string
  usesUrl: boolean
  usesIntegration: boolean
  /** Built-ins have bespoke forms; a plugin kind uses the generic form. */
  builtinForm: boolean
  resolve(toolset: Toolset, env: ToolsetResolveEnv): ToolsetResolution
}

const mcpType: ServerToolsetType = {
  kind: "mcp",
  label: "MCP",
  description: "Pick a set of tools from any MCP server (Slack, Gmail, Notion, …).",
  usesUrl: true,
  usesIntegration: true,
  builtinForm: true,
  resolve(toolset, { base, attention }) {
    return { entries: toolset.tools.map((tool) => mcpEntry(toolset, tool, base, attention)) }
  },
}

const sandboxType: ServerToolsetType = {
  kind: "sandbox",
  label: "Docker Sandbox",
  description: "A shell + filesystem backed by a Docker Sandbox integration's repos.",
  usesUrl: false,
  usesIntegration: true,
  builtinForm: true,
  resolve(toolset) {
    // Offered only when the daemon is up and the image is built. The team gate
    // (toolset + its integration) was already applied before we got here.
    if (!dockerSandboxEnabled()) return {}
    return { sandbox: dockerSandboxFactory(integrationRepos(toolset.integration)) }
  },
}

const BUILTIN: ServerToolsetType[] = [mcpType, sandboxType]

/** The reserved toolset kinds a plugin may not shadow — used by the boot guard. */
export const BUILTIN_TOOLSET_KINDS: readonly string[] = BUILTIN.map((type) => type.kind)

/** Resolve a toolset type by kind — a built-in, or a plugin kind adapted to the server shape. */
export function getToolsetType(kind: string): ServerToolsetType | undefined {
  const builtin = BUILTIN.find((type) => type.kind === kind)
  if (builtin) return builtin
  const plugin = pluginToolsetTypes().find((type) => type.kind === kind)
  return plugin ? adaptPluginType(plugin) : undefined
}

/** Every registered kind (built-in + plugin), for the "add toolset" UI. */
export function toolsetKinds(): ToolsetKindInfo[] {
  const all = [...BUILTIN, ...pluginToolsetTypes().map(adaptPluginType)]
  return all.map((type) => ({
    kind: type.kind,
    label: type.label,
    description: type.description,
    usesUrl: type.usesUrl,
    usesIntegration: type.usesIntegration,
    builtinForm: type.builtinForm,
  }))
}

/**
 * Resolve every team-permitted toolset grant into what to attach: the compact
 * entries to expose through the gateway, and the single sandbox factory to hand
 * `useSandbox` (the first one wins — Flue has one environment per agent).
 */
export function resolveToolsetContributions(
  permittedGrants: readonly string[],
  env: ToolsetResolveEnv,
): { entries: CompactEntry[]; sandbox?: SandboxFactory } {
  const entries: CompactEntry[] = []
  let sandbox: SandboxFactory | undefined
  for (const grant of permittedGrants) {
    const parsed = grantToolset(grant)
    if (!parsed) continue // a bare catalog-tool grant, handled elsewhere
    const toolset = getToolsetStore().get(parsed.name)
    if (!toolset) continue
    const type = getToolsetType(toolset.kind)
    if (!type) continue // an unknown kind (a retired plugin); offer nothing
    const contribution = type.resolve(toolset, env)
    if (contribution.entries) entries.push(...contribution.entries)
    if (contribution.sandbox && !sandbox) sandbox = contribution.sandbox
  }
  return { entries, sandbox }
}

/** Metadata for one tool a kind can expose, for the config UI's tool picker. */
export interface ToolsetToolMeta {
  name: string
  description: string
}

/**
 * The tools a plugin kind would expose for a draft toolset — for the "add
 * toolset" tool picker, so an admin can enable a subset. Runs the kind's own
 * `resolve` (which builds the tool descriptors) and reads their names and
 * descriptions; nothing is run. Built-in kinds return none here (MCP discovers
 * over the network instead).
 */
export function listToolsetTools(
  kind: string,
  toolset: Toolset,
  base: Omit<ToolContext, "credential">,
): ToolsetToolMeta[] {
  const plugin = pluginToolsetTypes().find((type) => type.kind === kind)
  if (!plugin) return []
  const contribution = plugin.resolve(toolset, pluginResolveContext(toolset, base))
  return (contribution.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
  }))
}

/**
 * The context a plugin toolset resolves against: the caller's identity, plus
 * lazy accessors for the toolset's linked integration credentials. The accessors
 * are bound to the toolset's `integration` and the caller's tenant, and read
 * nothing until a tool's `run` awaits them — so a kind that uses `process.env`
 * pays no cost, and one that reuses an integration reaches it only when called.
 */
function pluginResolveContext(
  toolset: Toolset,
  base: Omit<ToolContext, "credential">,
): ToolsetResolveContext {
  const name = toolset.integration
  return {
    tenantId: base.tenantId,
    agent: base.agent,
    session: base.session,
    jobId: base.jobId,
    integrationBearer: () =>
      name ? integrationBearer(name, base.tenantId) : Promise.resolve(undefined),
    integrationSecret: () =>
      Promise.resolve(name ? integrationSecret(name, base.tenantId) : undefined),
  }
}

/** Wrap a plugin toolset type as the server's internal driver. */
function adaptPluginType(def: ToolsetTypeDef): ServerToolsetType {
  return {
    kind: def.kind,
    label: def.label ?? def.kind,
    description: def.description ?? "",
    usesUrl: def.usesUrl ?? false,
    usesIntegration: def.usesIntegration ?? false,
    builtinForm: false,
    resolve(toolset, { base, attention }) {
      const contribution = def.resolve(toolset, pluginResolveContext(toolset, base))
      const all = contribution.tools ?? []
      // The admin enables a subset; an empty list means "all this kind offers"
      // (an API-created toolset with no selection, or a one-tool kind).
      const enabled =
        toolset.tools.length > 0 ? all.filter((tool) => toolset.tools.includes(tool.name)) : all
      return {
        entries: enabled.map((tool) =>
          pluginToolEntry(tool, toolset.gatedTools.includes(tool.name), base, attention),
        ),
        sandbox: contribution.sandbox,
      }
    },
  }
}

/**
 * A plugin toolset tool as a compact entry: validate against its schema, then
 * run — through the confirm-gate when the admin marked it for approval, exactly
 * as MCP and local catalog tools do.
 */
function pluginToolEntry(
  tool: ToolDefinition,
  gated: boolean,
  base: Omit<ToolContext, "credential">,
  attention: AttentionStore,
): CompactEntry {
  const input = tool.input as v.GenericSchema | undefined
  const run = tool.run as (arg: {
    data: unknown
    harness?: FlueHarness
    signal?: AbortSignal
  }) => Promise<string> | string
  return {
    name: tool.name,
    description: tool.description ?? "",
    needsApproval: gated,
    describe: () => (input ? toJsonSchema(input) : { type: "object", properties: {} }),
    // `harness` is the live agent environment, forwarded from `call_tool`; a
    // plugin tool declaring `harness: true` reaches its sandbox through it. The
    // gate wrapper only re-supplies `data`, so `harness`/`signal` are captured
    // from this closure and threaded into the tool's `run`.
    call: (args, signal, harness) => {
      let payload: unknown = args
      if (input) {
        const result = v.safeParse(input, args)
        if (!result.success) {
          return `Invalid arguments for ${tool.name}: ${result.issues[0]?.message}. Call describe_tool("${tool.name}").`
        }
        payload = result.output
      }
      return invokeGated(
        gated,
        base,
        tool.name,
        payload,
        ({ data }) => run({ data, harness, signal }),
        attention,
      )
    },
  }
}

/** The tools of one granted MCP server as compact entries, each named `server/tool`. */
function mcpEntry(
  server: Toolset,
  toolName: string,
  base: Omit<ToolContext, "credential">,
  attention: AttentionStore,
): CompactEntry {
  const name = `${server.name}/${toolName}`
  const target = targetOf(server)
  // The admin marks which of a toolset's tools are outbound/irreversible; those
  // suspend for operator approval, through the same one-shot gate local tools use.
  const gated = server.gatedTools.includes(toolName)
  // Resolve the calling user's own token from the named integration, lazily —
  // an agent that never calls the tool never needs the person connected.
  const bearer = async () => {
    const token = await integrationBearer(server.integration, base.tenantId)
    if (!token) {
      throw new Error(
        `${server.integration} is not connected. Connect it in Settings → Integrations to use ${name}.`,
      )
    }
    return token
  }
  // Turn a provider's 401 into a clear, actionable failure and flag the
  // integration stale, so it reads as "needs reconnect" rather than a silent
  // "connected" that keeps failing. Only an integration-backed toolset has a
  // credential to mark; a bare-URL MCP server's error is rethrown unchanged.
  const onError = (error: unknown): never => {
    if (isMcpAuthError(error) && server.integration) {
      markIntegrationStale(server.integration, base.tenantId)
      throw new Error(
        `${server.integration} rejected the connection — your authorization has expired or been revoked. Reconnect it in Settings → Integrations, then retry ${name}.`,
      )
    }
    throw error
  }
  return {
    name,
    description: server.toolDescriptions[toolName] ?? "",
    needsApproval: gated,
    describe: async () => {
      try {
        return (await describeMcpTool(target, toolName, await bearer())).inputSchema
      } catch (error) {
        return onError(error)
      }
    },
    call: (args, signal) =>
      invokeGated(
        gated,
        base,
        name,
        args,
        async ({ data }) => {
          try {
            const result = await callMcpTool(
              target,
              toolName,
              (data ?? {}) as Record<string, unknown>,
              await bearer(),
              base.session,
              signal,
            )
            // The call went through, so the token is good — clear any prior
            // stale mark (a no-op unless it was set).
            if (server.integration) clearIntegrationStale(server.integration, base.tenantId)
            return result
          } catch (error) {
            return onError(error)
          }
        },
        attention,
      ),
  }
}
