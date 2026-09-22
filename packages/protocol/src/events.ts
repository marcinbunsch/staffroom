import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"
import { ReportMode } from "./jobs.ts"

/**
 * The event bus.
 *
 * An event that matches a subscription opens a job — not a chat message, not a
 * new concept. A job already has a private session, a timeline, a deadline,
 * caps, operator inspection and cost attribution, so a reaction is ordinary job
 * history rather than a second kind of thing to inspect.
 *
 * Everything that initiates work is a producer on this bus. Schedules are the
 * first, and deliberately so: they are the producer we understand best, so if
 * the bus cannot express them cleanly the design is wrong and we find out
 * before anything else depends on it.
 */

/** A value a `where` clause can match. Equality only — no operators, no language. */
export const MatchValue = z.union([z.string(), z.number(), z.boolean()])

/**
 * An event type plus optional exact-match on fields. It covers every case in
 * the plan, indexes trivially, and cannot be written wrong in a way that
 * silently matches everything.
 */
export const EventMatch = z.object({
  type: z.string().min(1),
  where: z.record(z.string(), MatchValue).optional(),
})

export const EventScope = z.enum(["tenant", "org"])

export const EventEnvelope = z.object({
  id: z.string(),
  type: z.string().min(1),
  tenantId: TenantId,
  /** `org` is a short, named, auditable list; everything else is tenant-scoped. */
  scope: EventScope,
  /** Where it came from, for provenance: `schedule:daily-digest`, `job:42`. */
  source: z.string(),
  payload: z.record(z.string(), z.unknown()),
  /**
   * The subscriptions that produced this event, in order. A match is refused
   * when its subscription id is already here — that catches a cycle exactly,
   * with no threshold to tune — and the chain also answers "why did this open".
   * Shared with agent-to-agent calls (M11), so one cascade is one causal path.
   */
  chain: z.array(z.string()),
  depth: z.number().int().nonnegative(),
  at: z.string(),
})

export const EventEnvelopeInput = EventEnvelope.omit({ id: true, at: true }).partial({
  chain: true,
  depth: true,
  scope: true,
})

export const Subscription = z.object({
  id: z.string(),
  tenantId: TenantId,
  match: EventMatch,
  agent: AgentId,
  /** A human name for the work a match opens — the job's title. */
  title: z.string().min(1),
  instruction: z.string().min(1),
  /** Per-subscriber position. For a schedule this is its `lastFiredAt`. */
  cursor: z.string().nullable(),
  enabled: z.boolean(),
  /** An optional deadline (seconds) for the job a match opens. */
  deadlineSeconds: z.number().int().positive().nullable(),
  /** How the job a match opens reports back (a schedule's `reportMode`). */
  reportMode: ReportMode,
})

export type MatchValue = z.infer<typeof MatchValue>
export type EventMatch = z.infer<typeof EventMatch>
export type EventScope = z.infer<typeof EventScope>
export type EventEnvelope = z.infer<typeof EventEnvelope>
export type EventEnvelopeInput = z.infer<typeof EventEnvelopeInput>
export type Subscription = z.infer<typeof Subscription>

/**
 * Runaway fan-out that never repeats a subscription is caught by depth rather
 * than by the cycle guard. Shared with the job tree's cap: one cascade crossing
 * subscriptions, agent calls and child jobs is one number to reason about.
 */
export const MAX_EVENT_DEPTH = 5
