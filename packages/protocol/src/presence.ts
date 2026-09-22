import { z } from "zod"
import { AttentionKind } from "./attention.ts"

/**
 * A roster member's live presence — the one per-agent overview the rail reads.
 *
 * Ported from the prototype's AgentOverview: instead of the UI stitching
 * together unread counts, at-work state and pending attention from separate
 * calls, the server resolves them to a single activity per agent with a
 * precedence (needs-you beats responding beats working beats idle) and a compact
 * label. The rail then draws one status dot, one unread badge, one name weight
 * from this — never the prompt or a tool's contents.
 */
export const AgentActivity = z.enum(["idle", "responding", "working", "needs_you", "failed"])
export type AgentActivity = z.infer<typeof AgentActivity>

export const AgentAttention = z.object({
  id: z.string(),
  kind: AttentionKind,
  title: z.string(),
})
export type AgentAttention = z.infer<typeof AgentAttention>

export const AgentOverview = z.object({
  id: z.string(),
  activity: AgentActivity,
  /** A compact description of current work. Never includes prompt or tool content. */
  label: z.string().nullable(),
  jobId: z.number().int().positive().nullable(),
  unreadCount: z.number().int().nonnegative(),
  attention: AgentAttention.nullable(),
})
export type AgentOverview = z.infer<typeof AgentOverview>

export const AgentOverviewList = z.object({ agents: z.array(AgentOverview) })
export type AgentOverviewList = z.infer<typeof AgentOverviewList>
