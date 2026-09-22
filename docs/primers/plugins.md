# Plugins — a primer

How a deployment adds its own tools, integration providers, and toolset kinds
without forking the server. Read `architecture.md` first, and
`tools-and-credentials.md` for the catalog a plugin's tools join.

## The one idea

Staffroom's open-source server ships no proprietary tools. A deployment that
needs its own — a private API, an in-house provider — installs a **plugin**: a
bundle of _plain data_ (`@staffroom/plugin-core`), registered before the server
boots. A plugin never runs the server's render hooks itself; it hands the server
descriptors and the server does the attaching.

That last sentence is the whole design constraint, and it is not a style choice.
`useTool` / `useSandbox` read a render frame kept in `@flue/runtime`'s module
scope, so they only work from the copy of the runtime the server renders with. A
separately-installed plugin resolves its _own_ copy of the runtime, so a plugin
that called `useTool` itself would attach into the wrong frame and throw. So a
plugin passes data — `defineTool` descriptors, type definitions, a sandbox
factory — and the server, running in its own runtime, attaches them at render.

`@staffroom/plugin-core` is a tiny package on purpose: it holds the contract and
the registry and nothing else. It sits _outside_ the server's externalized Flue
bundle, which makes it a single shared module instance — the deployment's entry
file writes to the registry, and the running agent reads the same one back.

## Server mode: the only way plugins load

Plugins take effect through a **custom server-mode entry point**, never the
default `node dist/server.mjs` (which boots with no plugins). A deployment writes
a small entry file:

```ts
import { addPlugin, startServer } from "@staffroom/server/lib"
import { plugin } from "./my-plugin.ts"

addPlugin(plugin)
await startServer()
```

Order matters: `startServer` loads Flue's built application
(`server-lib.ts:startServer` → `dist/app.mjs`), and the server reads the plugin
registry as it boots. A plugin added after `startServer` is invisible. The
plugin's tools read their own configuration from `process.env` at call time, so
the entry runs with the deployment's own environment
(`node --env-file=.env index.ts`). A worked example lives in
`examples/custom-plugin-example/`.

## The two things a plugin contributes

A `StaffPlugin` (`@staffroom/plugin-core`) has an `id` and two optional arrays.
Each merges with the server's built-ins through one registry. Note what is
**not** here: a plugin does not contribute loose tools. A tool only exists
**inside a toolset** (a toolset kind's `resolve` returns it), so every capability
a plugin adds is a unit an admin installs and uninstalls as a toolset — the same
lifecycle as the built-in MCP and sandbox toolsets. A one-tool plugin is just a
toolset kind that returns one tool (see the example's `weather` kind).

**Integration types** — `integrationTypes: IntegrationTypeDef[]`. A new provider
an admin can register an app of and people connect their own account to.
`integrations.ts:allTypes` merges them with the five built-ins (Google, Slack,
GCP, Firecrawl, Docker); a plugin provider is then connectable in Settings and
authorizes MCP toolsets through the same generic OAuth/bearer path. The
`IntegrationTypeDef` shape lives in plugin-core so a plugin and the server share
one definition.

**Toolset kinds** — `toolsetTypes: ToolsetTypeDef[]`. A new `Toolset.kind`
beyond the built-in `mcp` and `sandbox`. A driver resolves a granted toolset row
into a `ToolsetContribution` — either Flue tool descriptors or a sandbox factory
— which the server attaches. `resolve` is **synchronous**: it runs inside the
render frame, which cannot await, so any slow work (a token fetch, a network
call) belongs inside the contributed tools' own `run`, reached lazily when the
agent calls them — exactly as the built-in MCP kind does.

### Why the toolset dimension needed a registry

The kind used to be a closed `z.enum(["mcp", "sandbox"])` and the render
dispatched it by hand — an `if (kind === "sandbox")` branch in the agent. That
does not extend. So `ToolsetKind` opened to a validated slug (the protocol bounds
its _shape_; the registry is the authority on which kinds _exist_), and the
hand-dispatch became `tools/toolset-types.ts`: a driver per kind, keyed by the
toolset row's own `kind`. The built-in `mcp` and `sandbox` drivers live there;
plugin kinds are adapted into the same internal shape. A grant is written
`<kind>:<name>` (`mcp:gmail`, `sandbox:repo`, `acme:foo`) — the same scheme for
built-ins and plugin kinds alike (`mcp.ts:grantToolset`).

A toolset _kind_ is a template, not an instance — nothing appears until an admin
creates a toolset of that kind. The kind declares UI metadata (`label`,
`description`, `usesUrl`, `usesIntegration`), which `GET /api/toolset-kinds`
exposes; Settings → Toolsets lists plugin kinds in its "add" picker and drives a
generic create form from those flags. A kind that authenticates its own way (from
`process.env`) leaves `usesIntegration` false, so it needs no integration and the
team integration gate does not apply to it. Once created, the toolset is grantable
from the agent editor as `<kind>:<name>` and renders through the registry like any
other.

**Reusing an existing integration's credentials.** A kind that sets
`usesIntegration: true` gets an integration picker on the create form; the chosen
integration's slug is stored as `toolset.integration`. Its `resolve` context then
carries two lazy accessors so a tool can piggyback that integration instead of
its own env config: `integrationBearer()` (a minted token — a GCP service account
becomes an access token, a token integration is the bearer as-is, an OAuth one
uses the caller's account) and `integrationSecret()` (the raw stored secret, e.g.
a GCP service-account JSON, for a tool that needs the credential itself). Both are
async and resolve `undefined` when the toolset has no integration or it is not
connected — call them inside a tool's `run`, never in `resolve`.

**Enabling a subset of a kind's tools.** A kind whose `resolve` returns several
tools gets a tool picker in the create form, so an admin installs only the ones
they want (and marks any for per-call approval) — the same "enable 2 of 5" flow
as MCP. The enabled names are stored in the toolset's `tools` (approval-gated
ones in `gatedTools`); `POST /api/toolsets/kind-tools` lists a draft's tools for
the picker by running the kind's `resolve` and reading the descriptors. At render
`adaptPluginType` keeps only the enabled tools (an empty list means "all the kind
offers"), and gates the ones in `gatedTools` through M7's confirm-gate.

## Guards: a broken install stops the boot

A silently shadowed built-in is worse than a stopped boot, so collisions fail
loud in two places:

- **Plugin vs. plugin**, when `addPlugin` runs (`plugin-core`): a duplicate
  plugin `id`, integration `type`, or toolset `kind`.
- **Plugin vs. built-in**, at boot (`plugins.ts:assertPluginsCompatible`, called
  from `app.ts:bootOnce`): a plugin integration type shadowing one of the five,
  or a plugin toolset kind shadowing `mcp`/`sandbox`.

## The tenant seam is unchanged

A plugin adds capability, not a new isolation boundary. A toolset kind's `resolve`
receives the caller's identity as a `ToolsetResolveContext` (tenant, agent,
session), so the tools it builds are bound to the calling tenant exactly as
built-ins are, and teams gate a plugin toolset the same way (`compact-tools.ts`).
The isolation contract tests hold with a plugin installed.

## Where each thing lives

| Concern                                 | Where                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------- |
| The contract + registry                 | `packages/plugin-core/src/index.ts`                                    |
| The custom server-mode entry            | `packages/server/src/server-lib.ts`                                    |
| Boot-time collision guard               | `packages/server/src/core/plugins.ts`                                  |
| Integration-type merge                  | `packages/server/src/core/integrations.ts`                             |
| Toolset-type registry + render dispatch | `packages/server/src/tools/toolset-types.ts`                           |
| The grant scheme `<kind>:<name>`        | `packages/server/src/tools/mcp.ts:grantToolset`                        |
| A worked deployment                     | `examples/custom-plugin-example/`                                      |
| Coverage                                | `packages/server/tests/plugins.test.ts`, `tools/toolset-types.test.ts` |
