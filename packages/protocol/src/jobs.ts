import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * A job is the unit of work.
 *
 * When a request is more than a quick answer, an agent opens a job. The job
 * holds its whole story in a timeline, can be handed between agents, and runs
 * in its own Flue session (`tenant:assignee__job-42`) so its turns are kept out
 * of the chats the operator reads.
 *
 * Every job belongs to one tenant. The session key carries that, which is what
 * lets a job resumed from Flue's poll loop after a restart still know whose it
 * is — see `agents/resolve-session.ts`.
 */
export const JobState = z.enum([
  /** Opened and dispatched, not yet started by its assignee. */
  "assigned",
  /** The assignee's session is working it. */
  "working",
  /** Blocked on an awaited child. Returns to `working` when the child closes. */
  "waiting_children",
  /** The operator is holding it. Excluded from the deadline sweep on purpose. */
  "paused",
  /** Closed with a summary. Terminal. */
  "done",
  /** Infrastructure or a missed deadline ended it. Terminal, but restartable. */
  "failed",
  /** The operator hard-stopped it. Terminal. */
  "cancelled",
])

export const TERMINAL_STATES: readonly JobState[] = ["done", "failed", "cancelled"]

/** What the deadline sweep does when a job overruns. */
export const OnOverrun = z.enum(["notify", "fail"])

/**
 * Whether a finished job announces itself.
 *
 * `always` posts the closing summary into the originator's chat (the default for
 * a job a person opened from a conversation — they asked, so they hear back).
 * `on_request` stays silent unless the assignee closes with `report: true`: the
 * job still records its summary and goes `done`, it just doesn't ping the chat.
 * That is how a "watch for X" schedule runs quietly and only speaks up when it
 * actually found something.
 */
export const ReportMode = z.enum(["always", "on_request"])

export const JobEntryKind = z.enum([
  "created",
  "assigned",
  "working",
  "note",
  "handed_off",
  "child_spawned",
  "child_done",
  "child_failed",
  "children_done",
  "closed",
  "failed",
  "recovered",
  "restarted",
  "paused",
  "resumed",
  "steer",
  "stopped",
  "cancelled",
  "escalated",
  "deadline_set",
])

/** Who did a thing to a job. Mirrors the audit actor. */
export const JobActor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), id: AgentId }),
  z.object({ kind: z.literal("operator") }),
  z.object({ kind: z.literal("scheduler") }),
  z.object({ kind: z.literal("system") }),
])

export const JobEntry = z.object({
  id: z.number().int(),
  jobId: z.number().int(),
  timestamp: z.string(),
  actor: JobActor,
  kind: JobEntryKind,
  text: z.string(),
})

export const Job = z.object({
  id: z.number().int(),
  tenantId: TenantId,
  title: z.string().min(1),
  instruction: z.string(),
  state: JobState,
  originatorAgent: AgentId,
  /** The session the result is reported back to. */
  originatorSession: z.string(),
  assigneeAgent: AgentId.nullable(),
  parentId: z.number().int().nullable(),
  depth: z.number().int().nonnegative(),
  /** Whether the parent blocks on this child (`waiting_children`). */
  awaited: z.boolean(),
  /** Whether closing this job announces its summary to the originator chat. */
  reportMode: ReportMode,
  summary: z.string().nullable(),
  /** Absolute wall-clock moment the job is expected to be done by. */
  deadlineAt: z.string().nullable(),
  onOverrun: OnOverrun.nullable(),
  /** Set once when the sweep escalates, so it never escalates twice. */
  escalatedAt: z.string().nullable(),
  /**
   * How many times recovery has re-driven this job after a transient turn
   * failure (a dropped model WebSocket, a 429). Reset to 0 whenever a turn
   * settles cleanly, so the count is consecutive failures, not lifetime ones.
   */
  attempts: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const JobDetail = Job.extend({
  entries: z.array(JobEntry),
  children: z.array(Job),
})

export type JobState = z.infer<typeof JobState>
export type OnOverrun = z.infer<typeof OnOverrun>
export type ReportMode = z.infer<typeof ReportMode>
export type JobEntryKind = z.infer<typeof JobEntryKind>
export type JobActor = z.infer<typeof JobActor>
export type JobEntry = z.infer<typeof JobEntry>
export type Job = z.infer<typeof Job>
export type JobDetail = z.infer<typeof JobDetail>
