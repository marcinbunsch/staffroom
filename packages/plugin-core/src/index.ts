import type { SandboxFactory, ToolDefinition } from "@flue/runtime"
import type { ConfigField, IntegrationKind, Toolset } from "@staffroom/protocol"

/**
 * @staffroom/plugin-core — the contract a Staffroom plugin implements, plus the
 * registry a deployment uses to install one.
 *
 * A plugin hands the server **plain data** — tool descriptors and type
 * definitions — and nothing else. It never calls `useTool`, `useSandbox`, or any
 * other Flue render hook itself. That split is load-bearing: those hooks read a
 * render frame kept in `@flue/runtime`'s module scope, so they only work from the
 * copy of the runtime the server renders with. A separately-installed plugin has
 * its own copy of the runtime, so a plugin that attached anything itself would
 * attach into the wrong frame and throw. Passing data sidesteps that — the
 * server does the render-time attachment with its own runtime.
 *
 * Why this lives in its own package rather than inside `@staffroom/server`: the
 * server's Flue build externalizes its dependencies, so this module resolves to
 * a **single shared instance**. A deployment's entry file calls `addPlugin` from
 * outside the built server bundle, and the server reads the same registry back
 * inside it.
 *
 * Plugins read their own configuration (API keys, endpoints) from `process.env`
 * at call time. The deployment owns that environment; the public server never
 * loads it.
 */

/** The generic OAuth spec an integration type supplies for its connect flow. */
export interface IntegrationOAuth {
  /** Build the consent URL for the instance's app config, redirect, and scopes. */
  buildAuthUrl(
    config: { clientId: string; clientSecret: string },
    redirectUri: string,
    state: string,
    scopes?: string[],
  ): string
  /** Exchange the returned code into the per-user secret (JSON) to store. */
  exchange(
    code: string,
    config: { clientId: string; clientSecret: string },
    redirectUri: string,
  ): Promise<string>
}

/**
 * A registerable integration type — a provider an admin can register an app of
 * and people connect their own account to. Built-ins (Google, Slack, GCP,
 * Firecrawl, Docker) and plugin-contributed types share this shape, and the
 * server merges them into one registry.
 */
export interface IntegrationTypeDef {
  type: string
  kind: IntegrationKind
  label: string
  description: string
  configFields: ConfigField[]
  defaultScopes: string[]
  unlocks: string[]
  /** A default MCP server URL an MCP toolset can prefill (e.g. Firecrawl). */
  defaultMcpUrl?: string
  oauth?: IntegrationOAuth
  /** Turn a stored per-user secret into a usable bearer token (for MCP toolsets). */
  bearer?(userSecret: string, orgSecret?: string): Promise<string> | string
  /**
   * `bearer` for a provider whose access tokens expire and whose refresh token
   * rotates (GitHub): returns the usable token, plus — when this call had to
   * refresh — the replacement secret to store in place of the old one. The
   * server persists it and serializes concurrent refreshes per user, so the
   * revoked token is never presented twice. Takes precedence over `bearer`.
   */
  rotatingBearer?(
    userSecret: string,
    orgSecret?: string,
  ): Promise<{ accessToken?: string; rotatedSecret?: string }>
}

/**
 * The render context a toolset type is handed when it resolves — the caller's
 * identity, so a contribution can be bound per tenant. Plain data, so it crosses
 * runtime copies safely.
 */
export interface ToolsetResolveContext {
  tenantId: string
  agent: string
  session: string
  jobId?: number
  /**
   * The toolset's linked integration credentials, for a kind that set
   * `usesIntegration: true` and reuses an existing integration rather than its
   * own `process.env` config. Both are **async** — call them inside a tool's
   * `run`, never in `resolve` (which cannot await). Both resolve to `undefined`
   * when the toolset has no integration, or it is not connected.
   *
   * - `integrationBearer()` — a usable bearer token, minted the same way the
   *   built-in MCP toolsets mint theirs (a GCP service account becomes an access
   *   token; a token integration is the bearer as-is; an OAuth one uses the
   *   caller's connected account).
   * - `integrationSecret()` — the raw stored secret, e.g. a GCP service-account
   *   JSON string, for a tool that needs the credential itself (a client SDK)
   *   rather than a bearer.
   */
  integrationBearer(): Promise<string | undefined>
  integrationSecret(): Promise<string | undefined>
}

/**
 * What a granted toolset contributes to one render — **plain data**, never a
 * render hook. The server turns `tools` into its compact catalog and hands
 * `sandbox` to `useSandbox`. A type returns one or the other (or neither, when
 * it is unavailable this render).
 */
export interface ToolsetContribution {
  /** Tools to expose, each a `defineTool` descriptor (reached via call_tool). */
  tools?: ToolDefinition[]
  /** A sandbox environment to attach; at most one per render wins. */
  sandbox?: SandboxFactory
}

/**
 * A registerable toolset kind — a driver that, given a granted toolset row and
 * the caller's context, returns what to attach. The built-in `mcp` and `sandbox`
 * kinds live in the server; a plugin adds more through this shape.
 */
export interface ToolsetTypeDef {
  kind: string
  /** Display name for the "add toolset" picker. Defaults to the kind. */
  label?: string
  /** One-line help shown under the picker option and on the create form. */
  description?: string
  /** Show a URL field on the create form, stored as the toolset's `url`. */
  usesUrl?: boolean
  /**
   * Show an integration picker on the create form and require one — for a kind
   * that authenticates or mounts through a registered integration. Default
   * false: the kind authenticates its own way (e.g. from `process.env`), and the
   * toolset needs no integration.
   */
  usesIntegration?: boolean
  /**
   * Resolve synchronously — it runs inside the agent's render frame, which
   * cannot await. Any slow work (a network call, a token fetch) belongs inside
   * the contributed tools' own `run`, reached lazily when the agent calls them,
   * exactly as the built-in MCP kind does.
   */
  resolve(toolset: Toolset, context: ToolsetResolveContext): ToolsetContribution
}

/**
 * A bundle of contributions installed together under one id.
 *
 * A plugin does not contribute loose tools. Tools only exist **inside a toolset**
 * (a `toolsetTypes` kind, whose `resolve` returns them), so every capability a
 * plugin adds is a unit an admin installs and uninstalls as a toolset — the same
 * lifecycle as the built-in MCP and sandbox toolsets. A plugin therefore
 * contributes integration types and toolset kinds, nothing more.
 */
export interface StaffPlugin {
  /** Stable identifier, used in startup logs and to reject a double install. */
  id: string
  /** Integration types this plugin adds — connectable in Settings and grantable. */
  integrationTypes?: IntegrationTypeDef[]
  /** Toolset kinds this plugin adds — grantable as `<kind>:<name>` and rendered. */
  toolsetTypes?: ToolsetTypeDef[]
}

/** Identity helper so authors get full type-checking on a plugin literal. */
export function definePlugin(plugin: StaffPlugin): StaffPlugin {
  return plugin
}

const registered: StaffPlugin[] = []

/**
 * Install a plugin. Call this before `startServer()`. Fails loud on a malformed
 * plugin or a name clash — a broken install should stop the boot, not limp on
 * with a silently missing or shadowed contribution.
 */
export function addPlugin(plugin: StaffPlugin): void {
  assertValidShape(plugin)
  if (registered.some((existing) => existing.id === plugin.id)) {
    throw new Error(`plugin "${plugin.id}" is already installed`)
  }
  for (const type of plugin.integrationTypes ?? []) {
    const owner = integrationTypeOwner(type.type)
    if (owner) {
      throw new Error(
        `plugin "${plugin.id}" integration type "${type.type}" collides with one from plugin "${owner}"`,
      )
    }
  }
  for (const type of plugin.toolsetTypes ?? []) {
    const owner = toolsetKindOwner(type.kind)
    if (owner) {
      throw new Error(
        `plugin "${plugin.id}" toolset kind "${type.kind}" collides with one from plugin "${owner}"`,
      )
    }
  }
  registered.push(plugin)
}

/** Every installed plugin, in install order. The server reads this to build its catalog. */
export function registeredPlugins(): readonly StaffPlugin[] {
  return registered
}

/** Every integration type contributed by an installed plugin, flattened. */
export function pluginIntegrationTypes(): IntegrationTypeDef[] {
  return registered.flatMap((plugin) => plugin.integrationTypes ?? [])
}

/** Every toolset type contributed by an installed plugin, flattened. */
export function pluginToolsetTypes(): ToolsetTypeDef[] {
  return registered.flatMap((plugin) => plugin.toolsetTypes ?? [])
}

/** Test-only: drop every registered plugin so a test starts from a clean registry. */
export function resetPlugins(): void {
  registered.length = 0
}

function integrationTypeOwner(type: string): string | undefined {
  return registered.find((plugin) =>
    (plugin.integrationTypes ?? []).some((candidate) => candidate.type === type),
  )?.id
}

function toolsetKindOwner(kind: string): string | undefined {
  return registered.find((plugin) =>
    (plugin.toolsetTypes ?? []).some((candidate) => candidate.kind === kind),
  )?.id
}

function assertValidShape(plugin: StaffPlugin): void {
  if (typeof plugin?.id !== "string" || plugin.id.trim() === "") {
    throw new Error("a plugin needs a non-empty string id")
  }
  const seenTypes = new Set<string>()
  for (const type of plugin.integrationTypes ?? []) {
    if (typeof type?.type !== "string" || type.type.trim() === "") {
      throw new Error(`plugin "${plugin.id}" has an integration type with no type`)
    }
    if (seenTypes.has(type.type)) {
      throw new Error(`plugin "${plugin.id}" lists integration type "${type.type}" twice`)
    }
    seenTypes.add(type.type)
  }
  const seenKinds = new Set<string>()
  for (const type of plugin.toolsetTypes ?? []) {
    if (typeof type?.kind !== "string" || type.kind.trim() === "") {
      throw new Error(`plugin "${plugin.id}" has a toolset type with no kind`)
    }
    if (typeof type.resolve !== "function") {
      throw new Error(`plugin "${plugin.id}" toolset type "${type.kind}" needs a resolve function`)
    }
    if (seenKinds.has(type.kind)) {
      throw new Error(`plugin "${plugin.id}" lists toolset kind "${type.kind}" twice`)
    }
    seenKinds.add(type.kind)
  }
}
