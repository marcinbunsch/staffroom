import { describe, expect, it } from "vitest"
import { DashboardsStore } from "../../src/coordinator/dashboards.ts"
import { WidgetsStore } from "../../src/coordinator/widgets.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

async function makeStores(): Promise<{ dashboards: DashboardsStore; widgets: WidgetsStore }> {
  const db = await migratedDatabase()
  const widgets = new WidgetsStore(db)
  return { dashboards: new DashboardsStore(db, widgets), widgets }
}

function widget(widgets: WidgetsStore, tenantId: string, agent: string, key: string): string {
  return widgets.put(tenantId, agent, { key, type: "markdown", title: key, content: "x" }).id
}

const BOX = { x: 0, y: 0, w: 4, h: 4 }

defineTenantIsolationTests("dashboards", async () => {
  const { dashboards } = await makeStores()
  return {
    create: (tenantId, seed) => dashboards.create(tenantId, seed).id,
    read: (tenantId, id) => dashboards.get(tenantId, id),
    list: (tenantId) => dashboards.list(tenantId),
    remove: (tenantId, id) => dashboards.remove(tenantId, id),
    update: (tenantId, id) => dashboards.rename(tenantId, id, "renamed") !== undefined,
  }
})

describe("dashboards", () => {
  it("places a widget and resolves it live in detail", async () => {
    const { dashboards, widgets } = await makeStores()
    const board = dashboards.create("alice", "Ops")
    const w = widget(widgets, "alice", "devops", "revenue")
    const item = dashboards.addItem("alice", board.id, w, BOX)
    expect(item).toBeTruthy()

    const detail = dashboards.detail("alice", board.id)
    expect(detail?.items).toHaveLength(1)
    expect(detail?.items[0]?.widget.key).toBe("revenue")
    expect(detail?.items[0]).toMatchObject(BOX)
  })

  it("reflects a widget update without touching the placement", async () => {
    const { dashboards, widgets } = await makeStores()
    const board = dashboards.create("alice", "Ops")
    widget(widgets, "alice", "devops", "revenue")
    const w = widgets.put("alice", "devops", {
      key: "revenue",
      type: "markdown",
      title: "Revenue",
      content: "first",
    })
    dashboards.addItem("alice", board.id, w.id, BOX)
    widgets.put("alice", "devops", {
      key: "revenue",
      type: "markdown",
      title: "Revenue",
      content: "second",
    })
    expect(dashboards.detail("alice", board.id)?.items[0]?.widget.content).toBe("second")
  })

  it("refuses to place a widget the tenant does not own", async () => {
    const { dashboards, widgets } = await makeStores()
    const board = dashboards.create("alice", "Ops")
    const theirs = widget(widgets, "bob", "devops", "revenue")
    expect(dashboards.addItem("alice", board.id, theirs, BOX)).toBeUndefined()
  })

  it("refuses to place onto another tenant's dashboard", async () => {
    const { dashboards, widgets } = await makeStores()
    const bobBoard = dashboards.create("bob", "Ops")
    const mine = widget(widgets, "alice", "devops", "revenue")
    expect(dashboards.addItem("alice", bobBoard.id, mine, BOX)).toBeUndefined()
  })

  it("drops placements when the referenced widget is deleted", async () => {
    const { dashboards, widgets } = await makeStores()
    const board = dashboards.create("alice", "Ops")
    const w = widget(widgets, "alice", "devops", "revenue")
    dashboards.addItem("alice", board.id, w, BOX)

    expect(widgets.remove("alice", w)).toBe(true)
    expect(dashboards.detail("alice", board.id)?.items).toHaveLength(0)
  })

  it("saves the grid layout, scoped to the dashboard", async () => {
    const { dashboards, widgets } = await makeStores()
    const board = dashboards.create("alice", "Ops")
    const w = widget(widgets, "alice", "devops", "revenue")
    const item = dashboards.addItem("alice", board.id, w, BOX)
    if (!item) throw new Error("expected item")

    expect(dashboards.setLayout("alice", board.id, [{ id: item.id, x: 2, y: 3, w: 6, h: 5 }])).toBe(
      true,
    )
    expect(dashboards.detail("alice", board.id)?.items[0]).toMatchObject({ x: 2, y: 3, w: 6, h: 5 })
  })
})
