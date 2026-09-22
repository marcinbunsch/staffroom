import { describe, expect, it } from "vitest"
import { ToolsetStore } from "../../src/coordinator/toolsets.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function store(): Promise<ToolsetStore> {
  return new ToolsetStore(await migratedDatabase())
}

const slack = {
  name: "slack",
  label: "Slack",
  kind: "mcp" as const,
  url: "https://mcp.example.com/slack",
  transport: "streamable-http" as const,
  integration: "slack",
  tools: ["search_messages", "list_channels"],
  gatedTools: ["search_messages"],
  toolDescriptions: { search_messages: "Search Slack", list_channels: "List channels" },
}

describe("the toolset store", () => {
  it("round-trips a registration", async () => {
    const servers = await store()
    const saved = servers.put(slack)
    expect(saved.name).toBe("slack")
    expect(saved.tools).toEqual(["search_messages", "list_channels"])
    expect(saved.gatedTools).toEqual(["search_messages"])
    expect(saved.toolDescriptions.search_messages).toBe("Search Slack")

    const read = servers.get("slack")
    expect(read).toEqual(saved)
    expect(servers.list()).toHaveLength(1)
  })

  it("put replaces an existing registration by name", async () => {
    const servers = await store()
    servers.put(slack)
    const updated = servers.put({ ...slack, tools: ["search_messages"], toolDescriptions: {} })

    expect(updated.tools).toEqual(["search_messages"])
    expect(servers.list()).toHaveLength(1) // replaced, not duplicated
    expect(servers.get("slack")?.createdAt).toBe(updated.createdAt) // kept the original created_at
  })

  it("removes a registration", async () => {
    const servers = await store()
    servers.put(slack)
    expect(servers.remove("slack")).toBe(true)
    expect(servers.get("slack")).toBeUndefined()
    expect(servers.remove("slack")).toBe(false)
  })

  it("has no tools selected by default is allowed (an empty selection)", async () => {
    const servers = await store()
    const saved = servers.put({ ...slack, tools: [], toolDescriptions: {} })
    expect(saved.tools).toEqual([])
  })
})
