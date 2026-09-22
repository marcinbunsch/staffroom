import { defineTool } from "@flue/runtime"
import type { ToolsetTypeDef } from "@staffroom/plugin-core"
import * as v from "valibot"

/**
 * Example 3 — a plugin TOOLSET KIND.
 *
 * A toolset kind is a driver for a new `Toolset.kind`, beyond the built-in `mcp`
 * and `sandbox`. `resolve` is handed a granted toolset row and the caller's
 * context, and returns **plain data** — Flue tool descriptors, or a sandbox
 * factory — which the server attaches. It never calls a render hook itself.
 *
 * `resolve` runs inside the agent's render frame, so it must be **synchronous**.
 * Any slow work (a network call, a token fetch) goes inside a returned tool's
 * own `run`, reached lazily when the agent calls it — exactly as the built-in
 * MCP kind does. So here `resolve` only reads the toolset's config and *builds*
 * tools; the tools do the I/O.
 *
 * Grant a toolset of this kind as `notes:<toolset-name>` (the `<kind>:<name>`
 * scheme).
 *
 * The `label`/`description`/`usesUrl` metadata drives the generic "add toolset"
 * form in Settings, so an admin can create a `notes` toolset from the UI. This
 * kind authenticates from `process.env` rather than a registered integration, so
 * `usesIntegration` is left false — no integration is required, and the team
 * integration gate does not apply to it.
 *
 * A contributed tool's name must be identifier-safe (snake_case), the same as
 * any `defineTool` name — it becomes the name the agent calls. If you support
 * more than one `notes` toolset at once, fold the toolset name into it (sanitized
 * to `[a-z0-9_]`) so two instances don't collide in the compact catalog.
 *
 * This kind offers three tools; the "add toolset" form lets an admin enable a
 * subset (e.g. read-only: just `notes_search` + `notes_list`) and mark any of
 * them for per-call approval. The server renders only the enabled ones.
 */
export const notesToolset: ToolsetTypeDef = {
  kind: "notes",
  label: "Notes",
  description: "Read and write a notes space over HTTP. Set NOTES_TOKEN in the environment.",
  usesUrl: true,
  resolve(toolset, context) {
    const baseUrl = toolset.url
    if (!baseUrl) return {} // misconfigured row — contribute nothing

    const token = () => process.env.NOTES_TOKEN
    const headers = () => ({
      authorization: `Bearer ${token()}`,
      // The caller's identity is on `context` if a request needs to be scoped
      // per tenant — bind it at build time, never trust an arg.
      "x-tenant": context.tenantId,
    })

    const search = defineTool({
      name: "notes_search",
      description: `Search the "${toolset.label}" notes space.`,
      input: v.object({ query: v.pipe(v.string(), v.description("What to search for.")) }),
      run: async ({ data }) => {
        if (!token()) return "notes is not configured: set NOTES_TOKEN in the environment."
        const response = await fetch(`${baseUrl}/search?q=${encodeURIComponent(data.query)}`, {
          headers: headers(),
        })
        return response.ok ? await response.text() : `notes search failed: ${response.status}`
      },
    })

    const list = defineTool({
      name: "notes_list",
      description: `List recent notes in "${toolset.label}".`,
      input: v.object({}),
      run: async () => {
        if (!token()) return "notes is not configured: set NOTES_TOKEN in the environment."
        const response = await fetch(`${baseUrl}/notes`, { headers: headers() })
        return response.ok ? await response.text() : `notes list failed: ${response.status}`
      },
    })

    const create = defineTool({
      name: "notes_create",
      description: `Create a note in "${toolset.label}". Outbound — a good candidate to gate.`,
      input: v.object({
        title: v.pipe(v.string(), v.description("Note title.")),
        body: v.pipe(v.string(), v.description("Note body.")),
      }),
      run: async ({ data }) => {
        if (!token()) return "notes is not configured: set NOTES_TOKEN in the environment."
        const response = await fetch(`${baseUrl}/notes`, {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify(data),
        })
        return response.ok ? `Created "${data.title}".` : `notes create failed: ${response.status}`
      },
    })

    return { tools: [search, list, create] }
  },
}

/**
 * A toolset kind can also contribute a sandbox instead of tools — return
 * `{ sandbox }` where `sandbox` is a Flue `SandboxFactory` (see
 * `packages/server/src/tools/docker-sandbox.ts:dockerSandboxFactory` for the
 * built-in one). At most one sandbox is attached per render.
 */
