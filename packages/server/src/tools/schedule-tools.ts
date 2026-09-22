import { defineTool, useTool } from "@flue/runtime"
import type { ReportMode, Schedule, Timing } from "@staffroom/protocol"
import { Cron } from "croner"
import * as v from "valibot"
import { type SchedulesStore, getSchedulesStore } from "../coordinator/schedules-store.ts"
import { getScheduler } from "../coordinator/scheduler.ts"

/**
 * The caller's identity, captured at render time. Flue does not tell a tool
 * which agent invoked it, so StaffAgent binds it in here — the same thing
 * attachJobTools and attachMemoryTools do.
 *
 * A schedule is addressed by its **title** rather than a caller-chosen id (ids
 * are generated), so "set the same title again" updates the existing one. Every
 * call is tenant-scoped.
 */
export interface ScheduleToolContext {
  tenantId: string
  agent: string
}

/**
 * Attach the schedule toolset for this render. Every agent gets it, and every
 * schedule an agent touches is its own — "do this every morning" and "run this
 * in three hours" should both work in conversation, but no agent may load up
 * another's schedules. A schedule firing opens an ordinary job, so scheduled
 * work is job history like any other.
 */
export function attachScheduleTools(context: ScheduleToolContext): void {
  useTool(makeScheduleSet(context))
  useTool(makeScheduleList(context))
  useTool(makeScheduleRemove(context))
}

function makeScheduleSet(context: ScheduleToolContext) {
  return defineTool({
    name: "schedule_set",
    description:
      "Create or change one of your schedules: it opens a job for you when it fires, with the instruction as the job's brief. A schedule runs as a routine (recurring — give `cron` or `every_seconds`) or once (a one-off — give `at` or `in_seconds`); a one-off fires a single time and is then done. Setting the same title again updates it. Cron and `at` run in the server's local time. Use this when the operator asks for something recurring or a one-time \"in N hours / at time X\"; state the schedule back to them in plain words so they can catch a wrong time.",
    input: v.object({
      title: v.pipe(
        v.string(),
        v.minLength(1),
        v.description("A short human title; setting the same one again updates that schedule"),
      ),
      instruction: v.pipe(
        v.optional(v.string()),
        v.description(
          "The brief for each run. Required when creating; omit to keep the current one.",
        ),
      ),
      cron: v.pipe(
        v.optional(v.string()),
        v.description(
          'Recurring: cron expression in server-local time, e.g. "0 7 * * 1-5" for 7:00 on weekdays',
        ),
      ),
      every_seconds: v.pipe(
        v.optional(v.number()),
        v.description("Recurring: fixed interval in seconds — an alternative to cron"),
      ),
      at: v.pipe(
        v.optional(v.string()),
        v.description(
          "One-off: an ISO 8601 timestamp to fire once at, e.g. 2026-09-19T15:00:00Z. Must be in the future.",
        ),
      ),
      in_seconds: v.pipe(
        v.optional(v.number()),
        v.description(
          'One-off: fire once this many seconds from now — the easy way to do "in three hours" (10800)',
        ),
      ),
      enabled: v.pipe(v.optional(v.boolean()), v.description("Pause or resume without deleting")),
      catch_up: v.pipe(
        v.optional(v.boolean()),
        v.description("Fire once at boot if a run was missed while the server was down"),
      ),
      deadline_seconds: v.pipe(
        v.optional(v.number()),
        v.description("An optional fail-safe deadline for the jobs this schedule opens"),
      ),
      report_when: v.pipe(
        v.optional(v.picklist(["always", "on_request"])),
        v.description(
          "'on_request' (default): each run stays silent unless it finds something worth reporting. 'always': every run reports back to your main chat (a daily digest).",
        ),
      ),
    }),
    run: async ({ data }) => {
      const message = setSchedule(getSchedulesStore(), context, data)
      reloadScheduler()
      return message
    },
  })
}

function makeScheduleList(context: ScheduleToolContext) {
  return defineTool({
    name: "schedule_list",
    description:
      "List your schedules: when each runs, its state (on/off/done), last run, and its instruction.",
    input: v.object({}),
    run: async () => listSchedules(getSchedulesStore(), context),
  })
}

function makeScheduleRemove(context: ScheduleToolContext) {
  return defineTool({
    name: "schedule_remove",
    description:
      "Delete one of your schedules by title. To pause a recurring one instead, use schedule_set with enabled false.",
    input: v.object({ title: v.pipe(v.string(), v.minLength(1)) }),
    run: async ({ data }) => {
      const message = removeSchedule(getSchedulesStore(), context, data.title)
      reloadScheduler()
      return message
    },
  })
}

export interface ScheduleSetInput {
  title: string
  instruction?: string
  cron?: string
  every_seconds?: number
  at?: string
  in_seconds?: number
  enabled?: boolean
  catch_up?: boolean
  deadline_seconds?: number
  report_when?: ReportMode
}

/** The logic behind schedule_set, separated from the tool so it can be tested. */
export function setSchedule(
  store: SchedulesStore,
  context: ScheduleToolContext,
  input: ScheduleSetInput,
): string {
  const given = [input.cron, input.every_seconds, input.at, input.in_seconds].filter(
    (value) => value !== undefined,
  )
  if (given.length > 1) {
    return "Give exactly one of cron, every_seconds, at, or in_seconds."
  }
  const timing = parseTiming(input)
  if (typeof timing === "string") return timing

  const title = input.title.trim()
  if (!title) return "A schedule needs a title."
  // Update matches an active (not completed) schedule; a title reused after a
  // one-off completed makes a fresh one rather than reviving the done record.
  const existing = store
    .list(context.tenantId)
    .find(
      (schedule) =>
        schedule.agent === context.agent &&
        schedule.title === title &&
        schedule.completedAt === null,
    )

  if (existing) {
    const schedule = store.update(context.tenantId, existing.id, {
      ...(timing ? { timing } : {}),
      ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.catch_up !== undefined ? { catchUp: input.catch_up } : {}),
      ...(input.deadline_seconds !== undefined ? { deadlineSeconds: input.deadline_seconds } : {}),
      ...(input.report_when !== undefined ? { reportMode: input.report_when } : {}),
    })
    if (!schedule) return `"${title}" disappeared while updating; try again.`
    return `Updated schedule "${schedule.title}" (${describeSchedule(schedule)}).`
  }

  if (!input.instruction) return `Creating "${title}" needs an instruction for each run.`
  if (!timing) {
    return `Creating "${title}" needs a time: cron, every_seconds, at, or in_seconds.`
  }

  const schedule = store.create(context.tenantId, {
    title,
    agent: context.agent,
    instruction: input.instruction,
    timing,
    catchUp: input.catch_up ?? false,
    deadlineSeconds: input.deadline_seconds ?? null,
    reportMode: input.report_when ?? "on_request",
  })
  return `Created schedule "${schedule.title}" (${describeSchedule(schedule)}).`
}

/** The logic behind schedule_list, separated for tests. */
export function listSchedules(store: SchedulesStore, context: ScheduleToolContext): string {
  const schedules = store
    .list(context.tenantId)
    .filter((schedule) => schedule.agent === context.agent)
  if (schedules.length === 0) {
    return "You have no schedules. Create one with schedule_set when the operator asks for recurring or one-time work."
  }
  return schedules
    .map((schedule) => {
      const last = schedule.lastFiredAt
        ? `last fired ${schedule.lastFiredAt.slice(0, 16).replace("T", " ")}`
        : "never fired"
      return `- ${schedule.title} (${describeSchedule(schedule)}, ${last})\n  ${schedule.instruction}`
    })
    .join("\n\n")
}

/** The logic behind schedule_remove, separated for tests. */
export function removeSchedule(
  store: SchedulesStore,
  context: ScheduleToolContext,
  title: string,
): string {
  const existing = store
    .list(context.tenantId)
    .find((schedule) => schedule.agent === context.agent && schedule.title === title.trim())
  if (!existing) return `You have no schedule titled "${title}".`
  store.remove(context.tenantId, existing.id)
  return `Removed schedule "${title}".`
}

/**
 * The timing from the input, a rejection message, or undefined when the input
 * carries none (an update keeping the current timing). A cron expression is
 * validated here because the scheduler constructs it blindly on reload — a bad
 * expression must fail this tool call, not the scheduler.
 */
function parseTiming(input: ScheduleSetInput): Timing | string | undefined {
  if (input.cron !== undefined) {
    try {
      const next = new Cron(input.cron).nextRun()
      if (!next) return `Cron "${input.cron}" never fires; check the expression.`
    } catch {
      return `"${input.cron}" is not a valid cron expression. Format: minute hour day month weekday.`
    }
    return { kind: "cron", expression: input.cron }
  }
  if (input.every_seconds !== undefined) {
    if (!Number.isInteger(input.every_seconds) || input.every_seconds <= 0) {
      return "every_seconds must be a positive whole number."
    }
    return { kind: "interval", seconds: input.every_seconds }
  }
  if (input.in_seconds !== undefined) {
    if (!Number.isInteger(input.in_seconds) || input.in_seconds <= 0) {
      return "in_seconds must be a positive whole number."
    }
    return { kind: "once", at: new Date(Date.now() + input.in_seconds * 1000).toISOString() }
  }
  if (input.at !== undefined) {
    const when = new Date(input.at)
    if (Number.isNaN(when.getTime())) {
      return `"${input.at}" is not a valid timestamp. Use ISO 8601, e.g. 2026-09-19T15:00:00Z.`
    }
    if (when.getTime() <= Date.now()) {
      return `"${input.at}" is in the past; give a future time.`
    }
    return { kind: "once", at: when.toISOString() }
  }
  return undefined
}

function describeSchedule(schedule: Schedule): string {
  if (schedule.timing.kind === "once") {
    const at = schedule.timing.at.slice(0, 16).replace("T", " ")
    const state = schedule.completedAt ? "done" : schedule.enabled ? "pending" : "off"
    return `once at ${at}, ${state}`
  }
  const when =
    schedule.timing.kind === "cron"
      ? `cron "${schedule.timing.expression}" in server time`
      : `every ${schedule.timing.seconds}s`
  return `${when}, ${schedule.enabled ? "on" : "off"}`
}

/**
 * Reschedule after a change. `getScheduler` returns the singleton app.ts already
 * started with the real sweep callback (the no-op here is ignored), and `reload`
 * is a no-op when the scheduler is not running — so this is safe on and off.
 */
function reloadScheduler(): void {
  getScheduler(() => {}).reload()
}
