import { describe, expect, it } from "vitest"
import { getOperatorEvents, type OperatorEnvelope } from "../../src/coordinator/operator-events.ts"
import { WidgetsStore } from "../../src/coordinator/widgets.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

async function makeStore(): Promise<WidgetsStore> {
  return new WidgetsStore(await migratedDatabase())
}

const AGENT = "devops"

// Widgets are tenant-private, like memory and jobs. The seed doubles as the key,
// so two seeds for one tenant are two widgets and a shared seed across tenants is
// two rows (the key is unique only within a tenant's agent).
defineTenantIsolationTests("widgets", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, seed) =>
      store.put(tenantId, AGENT, { key: seed, type: "markdown", title: seed, content: "body" }).id,
    read: (tenantId, id) => store.get(tenantId, id),
    list: (tenantId) => store.list(tenantId),
    remove: (tenantId, id) => store.remove(tenantId, id),
  }
})

describe("widgets", () => {
  it("creates a widget on first write", async () => {
    const store = await makeStore()
    const widget = store.put("alice", AGENT, {
      key: "revenue",
      type: "markdown",
      title: "Revenue",
      content: "**up**",
    })
    expect(widget).toMatchObject({
      agentId: AGENT,
      key: "revenue",
      type: "markdown",
      title: "Revenue",
      content: "**up**",
    })
  })

  it("updates in place on the same key, keeping id and created_at", async () => {
    const store = await makeStore()
    const first = store.put("alice", AGENT, {
      key: "revenue",
      type: "markdown",
      title: "Revenue",
      content: "old",
    })
    const second = store.put("alice", AGENT, {
      key: "revenue",
      type: "vega-lite",
      title: "Revenue chart",
      content: '{"mark":"bar"}',
    })

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.type).toBe("vega-lite")
    expect(second.content).toBe('{"mark":"bar"}')
    // One row, not two.
    expect(store.listForAgent("alice", AGENT)).toHaveLength(1)
  })

  it("keeps each agent's widgets separate under one tenant", async () => {
    const store = await makeStore()
    store.put("alice", "devops", { key: "k", type: "markdown", title: "A", content: "x" })
    store.put("alice", "sales", { key: "k", type: "markdown", title: "B", content: "y" })

    expect(store.listForAgent("alice", "devops")).toHaveLength(1)
    expect(store.listForAgent("alice", "sales")).toHaveLength(1)
    expect(store.list("alice")).toHaveLength(2)
  })

  it("removes a widget the tenant owns", async () => {
    const store = await makeStore()
    const widget = store.put("alice", AGENT, {
      key: "k",
      type: "markdown",
      title: "A",
      content: "x",
    })
    expect(store.remove("alice", widget.id)).toBe(true)
    expect(store.get("alice", widget.id)).toBeUndefined()
  })

  // A write rings the operator bus so open boards and dashboards refetch live.
  it("publishes widget.changed on put and on remove", async () => {
    const store = await makeStore()
    const seen: OperatorEnvelope[] = []
    const unsubscribe = getOperatorEvents().subscribe((envelope) => seen.push(envelope))
    try {
      const widget = store.put("alice", AGENT, {
        key: "k",
        type: "markdown",
        title: "A",
        content: "x",
      })
      // An in-place update (same key) rings the bell again.
      store.put("alice", AGENT, { key: "k", type: "markdown", title: "A", content: "y" })
      store.remove("alice", widget.id)

      expect(seen).toEqual([
        { tenantId: "alice", event: { type: "widget.changed", agent: AGENT } },
        { tenantId: "alice", event: { type: "widget.changed", agent: AGENT } },
        { tenantId: "alice", event: { type: "widget.changed", agent: AGENT } },
      ])
    } finally {
      unsubscribe()
    }
  })

  it("does not publish when remove hits nothing", async () => {
    const store = await makeStore()
    const seen: OperatorEnvelope[] = []
    const unsubscribe = getOperatorEvents().subscribe((envelope) => seen.push(envelope))
    try {
      expect(store.remove("alice", "no-such-id")).toBe(false)
      expect(seen).toEqual([])
    } finally {
      unsubscribe()
    }
  })
})
