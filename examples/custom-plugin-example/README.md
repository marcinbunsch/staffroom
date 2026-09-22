# Staffroom custom plugin example

A worked example of running Staffroom with your own plugin. Copy this directory
out of the repo to start your own — custom contributions do not belong in the
open-source tree. A plugin contributes two kinds of thing (a tool only exists
inside a toolset, so it installs/uninstalls as a unit), each in its own file
under `src/`:

| Dimension        | File                      | What it adds                                              |
| ---------------- | ------------------------- | --------------------------------------------------------- |
| Integration type | `src/acme-integration.ts` | `Acme`, a `token` provider connectable in Settings        |
| Toolset kind     | `src/weather-toolset.ts`  | `weather`, the simplest kind — a toolset that is one tool |
| Toolset kind     | `src/notes-toolset.ts`    | `notes`, a URL-backed toolset kind                        |

`src/plugin.ts` composes them into one `StaffPlugin`.

## How it works

A plugin hands the server **plain data** (tool descriptors, type definitions),
never Flue render calls — see the header of `@staffroom/plugin-core`. The
deployment's entry file registers the plugin and then starts the server:

```ts
import { addPlugin, startServer } from "@staffroom/server/lib"
import { plugin } from "./src/plugin.ts"

addPlugin(plugin)
await startServer()
```

Plugins **only** take effect through this custom server-mode entry — the default
`node dist/server.mjs` starts the server with no plugins. `addPlugin` must run
before `startServer`, because the server reads the registry as it boots.

## This is its own project, outside the monorepo

By design, this directory is **not** a member of the Staffroom workspace — it has
its own `pnpm-workspace.yaml` root, and its `package.json` reaches the repo's
packages through `link:` dependencies rather than `workspace:*`. That is the
whole point of the example: it proves a plugin resolves, typechecks, and runs
from a project outside the repo. Copy the directory anywhere and swap the `link:`
paths for published versions.

## Running

1. Build the server once, from the repo root, so `dist/app.mjs` exists:
   ```
   pnpm --filter @staffroom/server build
   ```
2. Install this example's own dependencies (it is its own project — this also
   resolves it for your editor, so the imports stop showing red):
   ```
   cd examples/custom-plugin-example
   pnpm install
   ```
3. Optionally typecheck it standalone:
   ```
   pnpm check
   ```
4. Fill in a `.env` (below) and start the server with your own environment:
   ```
   node --env-file=.env index.ts
   ```

A `.env` for this example:

```
WEATHER_API_KEY=...   # for the weather_lookup tool
NOTES_TOKEN=...       # for the notes toolset's tools
```

## Using each contribution

**The weather toolset.** Open Settings → Toolsets → _Add toolset_ and pick
`Weather` (it needs only a name — no URL, no integration). Grant it to a team in
the same form, then grant `weather:<name>` to an agent in the agent editor. It
renders the `weather_lookup` tool, backed by `WEATHER_API_KEY`.

**The integration type.** Open Settings → Integrations, add an `Acme`
integration, and paste its API key. Because it is a `token` provider, the key is
handed to any **MCP toolset** that names this integration as its bearer — so add
an MCP toolset pointing at Acme's MCP server, and grant it via a team.

**The toolset kind.** Open Settings → Toolsets → _Add toolset_; the `Notes` kind
appears in the picker alongside MCP and Docker Sandbox. Give it a name and a URL
(this kind authenticates from `NOTES_TOKEN`, so it needs no integration). It
offers three tools (`notes_search`, `notes_list`, `notes_create`) — **tick the
ones to enable** (e.g. read-only: search + list) and mark any for per-call
approval, the same as an MCP toolset. Grant it to a team in the same form, then
grant `notes:<name>` to an agent. Only the enabled tools render.

(You can also create it over the API:
`PUT /api/toolsets/team-notes { "label": "Team notes", "kind": "notes", "url": "https://notes.acme.example" }`.)

## Going further

See `docs/primers/plugins.md` for the full contract — the plain-data rule, the
`oauth`/`gcp`/`docker` integration shapes, contributing a sandbox from a toolset
kind, and how collisions fail the boot.
