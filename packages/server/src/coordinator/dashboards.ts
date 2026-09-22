import { randomUUID } from "node:crypto"
import {
  Dashboard,
  type DashboardDetail,
  DashboardItem,
  type DashboardItemLayout,
  type DashboardItemWithWidget,
  type Widget,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import type { DashboardItemTable, DashboardTable } from "./schema.ts"
import { WidgetsStore, getWidgetsStore } from "./widgets.ts"

/** A grid box for a placement, in column units. */
export interface ItemBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Dashboards: user-curated grids that reference live widgets. A dashboard holds
 * a layout — placements of `(widget_id, x, y, w, h)` — never widget content, so
 * an agent's update reaches every dashboard placing it on next read.
 *
 * Tenant-private throughout. A placement's ownership is checked two ways: the
 * dashboard must belong to the tenant, and (on add) so must the widget — so one
 * tenant can never pin another's widget or edit another's dashboard.
 */
export class DashboardsStore {
  readonly #db: Database
  readonly #widgets: WidgetsStore

  constructor(db: Database, widgets: WidgetsStore = new WidgetsStore(db)) {
    this.#db = db
    this.#widgets = widgets
  }

  list(tenantId: string): Dashboard[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("dashboards")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "asc"),
      )
      .map(rowToDashboard)
  }

  get(tenantId: string, id: string): Dashboard | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("dashboards")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return row ? rowToDashboard(row) : undefined
  }

  /** A dashboard plus its placed items, each resolved with its live widget. */
  detail(tenantId: string, id: string): DashboardDetail | undefined {
    const dashboard = this.get(tenantId, id)
    if (!dashboard) return undefined
    const rows = this.#db.all(
      this.#db.qb
        .selectFrom("dashboard_items")
        .selectAll()
        .where("dashboard_id", "=", id)
        .orderBy("y", "asc")
        .orderBy("x", "asc"),
    )
    // Resolve each placement's widget. The FK cascade means a placement's widget
    // exists, but a stale read is dropped rather than trusted.
    const widgets = new Map<string, Widget>()
    for (const widget of this.#widgets.list(tenantId)) widgets.set(widget.id, widget)
    const items: DashboardItemWithWidget[] = []
    for (const row of rows) {
      const widget = widgets.get(row.widget_id)
      if (!widget) continue
      items.push({ ...rowToItem(row), widget })
    }
    return { dashboard, items }
  }

  create(tenantId: string, name: string): Dashboard {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.#db.run(
      this.#db.qb.insertInto("dashboards").values({
        id,
        tenant_id: tenantId,
        name,
        created_at: now,
        updated_at: now,
      }),
    )
    return this.#require(id)
  }

  rename(tenantId: string, id: string, name: string): Dashboard | undefined {
    const result = this.#db.run(
      this.#db.qb
        .updateTable("dashboards")
        .set({ name, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return result.changes > 0 ? this.#require(id) : undefined
  }

  remove(tenantId: string, id: string): boolean {
    // Items cascade on the dashboard FK.
    const result = this.#db.run(
      this.#db.qb.deleteFrom("dashboards").where("tenant_id", "=", tenantId).where("id", "=", id),
    )
    return result.changes > 0
  }

  /**
   * Place a widget on a dashboard. Returns undefined if the tenant does not own
   * the dashboard or the widget — so a placement can never straddle tenants.
   */
  addItem(
    tenantId: string,
    dashboardId: string,
    widgetId: string,
    box: ItemBox,
  ): DashboardItem | undefined {
    if (!this.get(tenantId, dashboardId)) return undefined
    if (!this.#widgets.get(tenantId, widgetId)) return undefined
    const id = randomUUID()
    this.#db.run(
      this.#db.qb.insertInto("dashboard_items").values({
        id,
        dashboard_id: dashboardId,
        widget_id: widgetId,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        created_at: new Date().toISOString(),
      }),
    )
    this.#touch(dashboardId)
    const row = this.#db.get(
      this.#db.qb.selectFrom("dashboard_items").selectAll().where("id", "=", id),
    )
    return row ? rowToItem(row) : undefined
  }

  removeItem(tenantId: string, dashboardId: string, itemId: string): boolean {
    if (!this.get(tenantId, dashboardId)) return false
    const result = this.#db.run(
      this.#db.qb
        .deleteFrom("dashboard_items")
        .where("id", "=", itemId)
        .where("dashboard_id", "=", dashboardId),
    )
    if (result.changes > 0) this.#touch(dashboardId)
    return result.changes > 0
  }

  /**
   * Save the whole grid after a drag or resize. Scoped to the tenant's dashboard
   * and its own items, so a layout write cannot move another dashboard's boxes.
   */
  setLayout(tenantId: string, dashboardId: string, layouts: DashboardItemLayout[]): boolean {
    if (!this.get(tenantId, dashboardId)) return false
    this.#db.transaction(() => {
      for (const layout of layouts) {
        this.#db.run(
          this.#db.qb
            .updateTable("dashboard_items")
            .set({ x: layout.x, y: layout.y, w: layout.w, h: layout.h })
            .where("id", "=", layout.id)
            .where("dashboard_id", "=", dashboardId),
        )
      }
    })
    this.#touch(dashboardId)
    return true
  }

  #touch(dashboardId: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("dashboards")
        .set({ updated_at: new Date().toISOString() })
        .where("id", "=", dashboardId),
    )
  }

  #require(id: string): Dashboard {
    const row = this.#db.get(this.#db.qb.selectFrom("dashboards").selectAll().where("id", "=", id))
    if (!row) throw new Error(`dashboard "${id}" did not persist`)
    return rowToDashboard(row)
  }
}

function rowToDashboard(row: DashboardTable): Dashboard {
  return Dashboard.parse({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function rowToItem(row: DashboardItemTable): DashboardItem {
  return DashboardItem.parse({
    id: row.id,
    widgetId: row.widget_id,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
  })
}

let store: DashboardsStore | undefined

export function getDashboardsStore(): DashboardsStore {
  if (!store) store = new DashboardsStore(getDatabase(), getWidgetsStore())
  return store
}
