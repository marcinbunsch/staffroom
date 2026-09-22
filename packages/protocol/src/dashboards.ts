import { z } from "zod"
import { TenantId } from "./identity.ts"
import { Widget } from "./widgets.ts"

/**
 * A dashboard is a user-curated grid that **references** live widgets from any
 * agent — it stores only a layout, never a copy. When an agent updates a widget,
 * every dashboard placing it reflects the latest on next open. Tenant-private.
 *
 * A placement (`DashboardItem`) is a widget id plus its grid box `(x, y, w, h)`
 * in column units. Deleting the referenced widget removes its placements (an FK
 * cascade), so a dashboard never points at a widget that is gone.
 */
export const Dashboard = z.object({
  id: z.string(),
  tenantId: TenantId,
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const DashboardItem = z.object({
  id: z.string(),
  widgetId: z.string(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
})

/** An item resolved with the live widget it references, for rendering. */
export const DashboardItemWithWidget = DashboardItem.extend({ widget: Widget })

/** A dashboard plus its placed, resolved items — the detail read. */
export const DashboardDetail = z.object({
  dashboard: Dashboard,
  items: z.array(DashboardItemWithWidget),
})

/** One placement's box, for the bulk layout save on drag/resize end. */
export const DashboardItemLayout = z.object({
  id: z.string(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
})

export type Dashboard = z.infer<typeof Dashboard>
export type DashboardItem = z.infer<typeof DashboardItem>
export type DashboardItemWithWidget = z.infer<typeof DashboardItemWithWidget>
export type DashboardDetail = z.infer<typeof DashboardDetail>
export type DashboardItemLayout = z.infer<typeof DashboardItemLayout>
