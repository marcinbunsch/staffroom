import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * A widget is one durable, self-updating output an agent produces: a Markdown
 * block or a Vega-Lite chart. The agent addresses it by a stable `key`, so the
 * same key on the next run **updates in place** — a widget is one row,
 * overwritten, with no version history. It is a snapshot of what the agent knew
 * on its last run; the agent's own memory is the history behind it.
 *
 * Every widget is owned by exactly one agent (its `agentId`) and is private to
 * the tenant, like memory and jobs. The agent's *board* is the set of its
 * widgets; a *dashboard* (a later phase) is a grid that references widgets from
 * any agent, so an update reaches every dashboard showing it for free.
 */
export const WidgetType = z.enum(["markdown", "vega-lite"])

export const Widget = z.object({
  id: z.string(),
  tenantId: TenantId,
  agentId: AgentId,
  /** Stable per (tenant, agent): the same key re-used is an update in place. */
  key: z.string().min(1),
  type: WidgetType,
  title: z.string(),
  /** Markdown text, or a Vega-Lite JSON spec as a string, per `type`. */
  content: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
})

/** What the tool accepts to create or update a widget. */
export const WidgetInput = z.object({
  key: z.string().min(1).max(128),
  type: WidgetType,
  title: z.string().min(1).max(200),
  content: z.string().min(1),
})

export type WidgetType = z.infer<typeof WidgetType>
export type Widget = z.infer<typeof Widget>
export type WidgetInput = z.infer<typeof WidgetInput>

/**
 * The operator-stream event a widget write will publish, once the live-push
 * path is wired (deferred: boards fetch on open in v1). Named here now so the
 * one place wire types live stays the single source of truth.
 */
export const WIDGET_CHANGED = "widget.changed"
