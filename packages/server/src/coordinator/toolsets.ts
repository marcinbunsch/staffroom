import { Toolset, type ToolsetInput } from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import type { ToolsetTable } from "./schema.ts"

/**
 * Registered toolsets — org-wide config, keyed by slug name.
 *
 * A toolset here is an MCP-backed set of tools (url + transport + selection);
 * built-in toolsets like Firecrawl are code-defined, not rows. No tenant
 * column: like an integration, an admin registers a toolset once and everyone's
 * agents may be granted it. The per-user token that authorizes the connection
 * is resolved elsewhere (the named integration), not here.
 */
export class ToolsetStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  list(): Toolset[] {
    return this.#db
      .all(this.#db.qb.selectFrom("toolsets").selectAll().orderBy("name", "asc"))
      .map(rowToToolset)
  }

  get(name: string): Toolset | undefined {
    const row = this.#db.get(
      this.#db.qb.selectFrom("toolsets").selectAll().where("name", "=", name),
    )
    return row ? rowToToolset(row) : undefined
  }

  /** Insert or replace a registration by name. */
  put(input: ToolsetInput): Toolset {
    const now = new Date().toISOString()
    const values = {
      label: input.label,
      kind: input.kind,
      url: input.url ?? "",
      transport: input.transport ?? "streamable-http",
      integration: input.integration,
      tools: JSON.stringify(input.tools ?? []),
      gated_tools: JSON.stringify(input.gatedTools ?? []),
      tool_descriptions: JSON.stringify(input.toolDescriptions ?? {}),
      updated_at: now,
    }
    const existing = this.get(input.name)
    if (existing) {
      this.#db.run(this.#db.qb.updateTable("toolsets").set(values).where("name", "=", input.name))
    } else {
      this.#db.run(
        this.#db.qb.insertInto("toolsets").values({ name: input.name, ...values, created_at: now }),
      )
    }
    const saved = this.get(input.name)
    if (!saved) throw new Error(`MCP server "${input.name}" did not persist`)
    return saved
  }

  remove(name: string): boolean {
    return this.#db.run(this.#db.qb.deleteFrom("toolsets").where("name", "=", name)).changes > 0
  }
}

function rowToToolset(row: ToolsetTable): Toolset {
  return Toolset.parse({
    name: row.name,
    label: row.label ?? row.name,
    kind: row.kind ?? "mcp",
    url: row.url || undefined,
    transport: row.transport || undefined,
    integration: row.integration,
    tools: JSON.parse(row.tools),
    gatedTools: JSON.parse(row.gated_tools ?? "[]"),
    toolDescriptions: JSON.parse(row.tool_descriptions),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

let store: ToolsetStore | undefined

export function getToolsetStore(): ToolsetStore {
  if (!store) store = new ToolsetStore(getDatabase())
  return store
}
