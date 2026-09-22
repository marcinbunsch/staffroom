import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"
import { ReportMode } from "./jobs.ts"

/**
 * When a schedule runs. A schedule either **runs as a routine** (recurring —
 * `cron` or `interval`) or **runs once** (`once`, a one-off at a specific time).
 * The recurring variants fire forever until disabled; a `once` fires a single
 * time and is then marked completed.
 */
export const Timing = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cron"), expression: z.string().min(1) }),
  z.object({ kind: z.literal("interval"), seconds: z.number().int().positive() }),
  z.object({ kind: z.literal("once"), at: z.string().datetime() }),
])

/**
 * A schedule holds two things: **when** and **what**.
 *
 * It is one row, and both a timer and a subscription derive from it. The
 * producer owns the clock and publishes `schedule.fired`; the subscription owns
 * the reaction — match that event, open a job for this agent with this
 * instruction. There is no separate producer table and no subscription table,
 * so the Schedules screen, the CLI and the protocol all see a schedule as
 * exactly one editable thing.
 */
export const Schedule = z.object({
  id: z.string(),
  tenantId: TenantId,
  title: z.string().min(1),
  agent: AgentId,
  instruction: z.string().min(1),
  timing: Timing,
  /** Fire a missed run once on startup, rather than skipping it. */
  catchUp: z.boolean(),
  enabled: z.boolean(),
  /** An optional fail-safe deadline for the jobs this schedule opens. */
  deadlineSeconds: z.number().int().positive().nullable(),
  /**
   * How the jobs this schedule opens report back. Defaults to `on_request`: a
   * schedule runs quietly and only surfaces to its agent's main chat when it
   * has something worth reporting. Set `always` for one that should speak every
   * run (a daily digest).
   */
  reportMode: ReportMode,
  /**
   * The subscription cursor: when this schedule last fired. The field that
   * answers "did we miss a run while down" is what a durable bus calls a
   * per-subscriber position, so catch-up is a cursor comparison.
   */
  lastFiredAt: z.string().nullable(),
  /**
   * When a one-off (`once`) fired and was marked done. A completed schedule is
   * kept as a record but drops out of the derived subscriptions, so it never
   * fires again. Always null for recurring schedules.
   */
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const ScheduleInput = Schedule.pick({
  title: true,
  agent: true,
  instruction: true,
  timing: true,
}).extend({
  catchUp: z.boolean().default(false),
  deadlineSeconds: z.number().int().positive().nullable().default(null),
  reportMode: ReportMode.default("on_request"),
})

export const ScheduleUpdate = Schedule.pick({
  title: true,
  agent: true,
  instruction: true,
  timing: true,
  catchUp: true,
  enabled: true,
  deadlineSeconds: true,
  reportMode: true,
}).partial()

export type Timing = z.infer<typeof Timing>
export type Schedule = z.infer<typeof Schedule>
export type ScheduleInput = z.input<typeof ScheduleInput>
export type ScheduleUpdate = z.infer<typeof ScheduleUpdate>

/** The event a fired schedule publishes, and the source a schedule's subscription matches. */
export function scheduleSource(scheduleId: string): string {
  return `schedule:${scheduleId}`
}

export const SCHEDULE_FIRED = "schedule.fired"
