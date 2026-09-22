import { describe, expect, it } from "vitest"
import { OperatorProfileStore } from "../../src/coordinator/operator-profile.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function makeStore(): Promise<OperatorProfileStore> {
  return new OperatorProfileStore(await migratedDatabase())
}

// The operator profile is a singleton per tenant, not an id-keyed collection, so
// the shared `defineTenantIsolationTests` (which creates records by id) does not
// fit. The isolation it guards still matters — one account must never read or
// overwrite another's — so it is asserted directly here.
describe("operator profile: tenant isolation", () => {
  it("does not read another tenant's profile", async () => {
    const store = await makeStore()
    store.set("tenant-b", "I am Bob.")

    expect(store.get("tenant-a").text).toBe("")
    expect(store.get("tenant-b").text).toBe("I am Bob.")
  })

  it("does not overwrite another tenant's profile", async () => {
    const store = await makeStore()
    store.set("tenant-a", "I am Alice.")
    store.set("tenant-b", "I am Bob.")

    expect(store.get("tenant-a").text).toBe("I am Alice.")
    expect(store.get("tenant-b").text).toBe("I am Bob.")
  })
})

describe("operator profile", () => {
  it("is empty until written", async () => {
    const store = await makeStore()
    expect(store.get("tenant-a")).toEqual({ text: "", updatedAt: null })
  })

  it("round-trips the text and stamps updatedAt", async () => {
    const store = await makeStore()
    const written = store.set("tenant-a", "I am Alex, CTO at Acme.")

    expect(written.text).toBe("I am Alex, CTO at Acme.")
    expect(written.updatedAt).not.toBeNull()
    expect(store.get("tenant-a")).toEqual(written)
  })

  it("replaces a previous profile rather than adding a row", async () => {
    const store = await makeStore()
    store.set("tenant-a", "First version.")
    const second = store.set("tenant-a", "Second version, with my GitHub handle.")

    expect(store.get("tenant-a").text).toBe("Second version, with my GitHub handle.")
    expect(store.get("tenant-a").updatedAt).toBe(second.updatedAt)
  })
})
