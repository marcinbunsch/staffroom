import { describe, expect, it } from "vitest"
import { IntegrationStore } from "../../src/coordinator/integrations.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function store(): Promise<IntegrationStore> {
  return new IntegrationStore(await migratedDatabase())
}

describe("the integration store", () => {
  it("seeds the default google and slack instances", async () => {
    const integrations = await store()
    const names = integrations.list().map((i) => i.name)
    expect(names).toEqual(["google", "slack"])
    const google = integrations.get("google")
    expect(google?.type).toBe("google")
    expect(google?.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly")
  })

  it("registers a second instance of a type with its own scopes", async () => {
    const integrations = await store()
    const created = integrations.put({
      name: "slack-write",
      label: "Slack (write)",
      type: "slack",
      scopes: ["chat:write", "channels:read"],
      repos: [],
    })
    expect(created.type).toBe("slack")
    expect(created.scopes).toEqual(["chat:write", "channels:read"])
    // Both slack instances coexist.
    expect(integrations.list().filter((i) => i.type === "slack")).toHaveLength(2)
  })

  it("put replaces an existing instance by name", async () => {
    const integrations = await store()
    integrations.put({ name: "slack", label: "Slack", type: "slack", scopes: ["a"], repos: [] })
    const updated = integrations.put({
      name: "slack",
      label: "Renamed",
      type: "slack",
      scopes: ["b"],
      repos: [],
    })
    expect(updated.label).toBe("Renamed")
    expect(updated.scopes).toEqual(["b"])
    expect(integrations.list().filter((i) => i.name === "slack")).toHaveLength(1)
  })

  it("removes an instance", async () => {
    const integrations = await store()
    expect(integrations.remove("slack")).toBe(true)
    expect(integrations.get("slack")).toBeUndefined()
    expect(integrations.remove("slack")).toBe(false)
  })
})
