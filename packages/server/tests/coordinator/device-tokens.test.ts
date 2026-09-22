import { describe, expect, it } from "vitest"
import { DeviceTokenStore } from "../../src/coordinator/device-tokens.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function makeStore(): Promise<DeviceTokenStore> {
  return new DeviceTokenStore(await migratedDatabase())
}

// The registry is keyed by device token, not by a per-tenant id, so the shared
// `defineTenantIsolationTests` (which creates records by id) does not fit. The
// isolation it guards still matters — a dispatch for one account must never
// reach another's devices — so it is asserted directly here.
describe("device tokens: tenant isolation", () => {
  it("lists only a tenant's own devices", async () => {
    const store = await makeStore()
    store.register("tenant-a", "token-a", "ios")
    store.register("tenant-b", "token-b", "ios")

    expect(store.list("tenant-a")).toEqual([{ token: "token-a", platform: "ios", keys: null }])
    expect(store.list("tenant-b")).toEqual([{ token: "token-b", platform: "ios", keys: null }])
  })

  it("cannot unregister another tenant's token", async () => {
    const store = await makeStore()
    store.register("tenant-a", "token-a", "ios")

    store.unregister("tenant-b", "token-a")

    expect(store.list("tenant-a")).toEqual([{ token: "token-a", platform: "ios", keys: null }])
  })
})

describe("device tokens", () => {
  it("is empty until a device registers", async () => {
    const store = await makeStore()
    expect(store.list("tenant-a")).toEqual([])
  })

  it("stores a web subscription's endpoint and keys", async () => {
    const store = await makeStore()
    store.register("tenant-a", "https://push.example.com/abc", "web", {
      p256dh: "p256dh-value",
      auth: "auth-value",
    })

    expect(store.list("tenant-a")).toEqual([
      {
        token: "https://push.example.com/abc",
        platform: "web",
        keys: { p256dh: "p256dh-value", auth: "auth-value" },
      },
    ])
  })

  it("upserts on re-register rather than duplicating the token", async () => {
    const store = await makeStore()
    store.register("tenant-a", "token-a", "ios")
    store.register("tenant-a", "token-a", "ios")

    expect(store.list("tenant-a")).toHaveLength(1)
  })

  it("moves a token to the tenant that last registered it", async () => {
    const store = await makeStore()
    store.register("tenant-a", "shared", "ios")
    store.register("tenant-b", "shared", "ios")

    expect(store.list("tenant-a")).toEqual([])
    expect(store.list("tenant-b")).toEqual([{ token: "shared", platform: "ios", keys: null }])
  })

  it("unregisters a tenant's own token", async () => {
    const store = await makeStore()
    store.register("tenant-a", "token-a", "ios")
    store.unregister("tenant-a", "token-a")

    expect(store.list("tenant-a")).toEqual([])
  })

  it("purges a token regardless of owner (APNs said it is gone)", async () => {
    const store = await makeStore()
    store.register("tenant-a", "dead", "ios")

    store.purge("dead")

    expect(store.list("tenant-a")).toEqual([])
  })
})
