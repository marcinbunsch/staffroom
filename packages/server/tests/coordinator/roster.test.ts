import { describe, expect, it } from "vitest"
import { RosterStore, StaffExistsError } from "../../src/coordinator/roster.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

async function makeStore(): Promise<RosterStore> {
  return new RosterStore(await migratedDatabase())
}

function seed(store: RosterStore, tenantId: string, id: string) {
  return store.create(tenantId, { id, name: id, systemPrompt: "You are helpful.", tools: [] })
}

defineTenantIsolationTests("roster", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, id) => seed(store, tenantId, id).id,
    read: (tenantId, id) => store.get(tenantId, id),
    list: (tenantId) => store.list(tenantId),
    update: (tenantId, id) => store.update(tenantId, id, { name: "renamed" }) !== undefined,
    remove: (tenantId, id) => store.remove(tenantId, id),
  }
})

describe("roster", () => {
  it("round-trips a member", async () => {
    const store = await makeStore()
    const created = store.create("tenant-a", {
      id: "devops",
      name: "DevOps",
      description: "Keeps production systems reliable.",
      systemPrompt: "You keep the lights on.",
      model: "openai-codex/gpt-5.5",
      tools: ["current_time"],
    })

    expect(created).toMatchObject({
      tenantId: "tenant-a",
      id: "devops",
      name: "DevOps",
      description: "Keeps production systems reliable.",
      model: "openai-codex/gpt-5.5",
      tools: ["current_time"],
      enabled: true,
    })
    expect(store.get("tenant-a", "devops")).toEqual(created)
  })

  it("refuses a duplicate id within one tenant", async () => {
    const store = await makeStore()
    seed(store, "tenant-a", "devops")
    expect(() => seed(store, "tenant-a", "devops")).toThrow(StaffExistsError)
  })

  // The same agent id in two tenants is not a duplicate. This is the whole
  // point of the composite key, so it gets its own case rather than relying on
  // the shared contract.
  it("allows the same id in two tenants", async () => {
    const store = await makeStore()
    seed(store, "tenant-a", "devops")
    expect(() => seed(store, "tenant-b", "devops")).not.toThrow()
    expect(store.get("tenant-a", "devops")?.tenantId).toBe("tenant-a")
    expect(store.get("tenant-b", "devops")?.tenantId).toBe("tenant-b")
  })

  it("orders by sort order, counted per tenant", async () => {
    const store = await makeStore()
    seed(store, "tenant-b", "first")
    seed(store, "tenant-a", "alpha")
    seed(store, "tenant-a", "beta")

    expect(store.list("tenant-a").map((member) => member.id)).toEqual(["alpha", "beta"])
  })

  it("applies a partial update and leaves the rest alone", async () => {
    const store = await makeStore()
    seed(store, "tenant-a", "devops")
    const updated = store.update("tenant-a", "devops", { name: "Operations" })

    expect(updated?.name).toBe("Operations")
    expect(updated?.systemPrompt).toBe("You are helpful.")
    expect(updated?.description).toBe("")
  })

  it("returns undefined updating a member that is not there", async () => {
    const store = await makeStore()
    expect(store.update("tenant-a", "ghost", { name: "x" })).toBeUndefined()
  })
})
