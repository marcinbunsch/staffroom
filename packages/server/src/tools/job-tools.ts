import { defineTool, useTool } from "@flue/runtime"
import { type Job, type JobActor, TERMINAL_STATES } from "@staffroom/protocol"
import * as v from "valibot"
import { JobCapError, getJobsCoordinator } from "../coordinator/jobs.ts"
import { getRosterStore } from "../coordinator/roster.ts"

// How long `job_await` blocks by default, and the most it will ever wait — a
// fail-safe so a stuck child cannot hang the parent turn indefinitely.
const AWAIT_DEFAULT_SECONDS = 900
const AWAIT_MAX_SECONDS = 1800

/**
 * The caller's identity, captured at render time. Flue's ToolContext does not
 * carry which agent or session invoked a tool, so `StaffAgent` binds it in when
 * it attaches these — the same seam that binds the tenant.
 */
export interface JobToolContext {
  tenantId: string
  agent: string
  session: string
  jobId?: number
}

/**
 * Attach the job toolset for this render. Every agent can open and list jobs; an
 * agent already inside a job session also gets the working set (note, hand off,
 * spawn, close, read) bound to that job.
 */
export function attachJobTools(context: JobToolContext): void {
  useTool(makeJobCreate(context))
  useTool(makeListJobs(context))
  useTool(makeGetJob(context))
  if (context.jobId !== undefined) {
    const jobId = context.jobId
    useTool(makeJobNote(jobId, context))
    useTool(makeJobHandoff(jobId, context))
    useTool(makeJobSpawn(jobId, context))
    useTool(makeJobAwait(jobId, context))
    useTool(makeJobClose(jobId, context))
    useTool(makeJobRead(jobId, context))
  }
}

function actorOf(context: JobToolContext): JobActor {
  return { kind: "agent", id: context.agent }
}

// A tool call that hits a loop guardrail returns the reason to the model rather
// than throwing, so the agent can react (pick another assignee, or stop).
function capMessage(error: unknown): string | undefined {
  return error instanceof JobCapError ? error.message : undefined
}

function knownAgent(tenantId: string, agent: string): boolean {
  return getRosterStore().get(tenantId, agent) !== undefined
}

function makeJobCreate(context: JobToolContext) {
  return defineTool({
    name: "job_create",
    description:
      "Open a job and assign it (to yourself or another staff member) to get real, multi-step work done. Use this instead of doing sprawling work inline. Returns the job id.",
    input: v.object({
      title: v.pipe(v.string(), v.minLength(1), v.description("Short title for the job")),
      instruction: v.pipe(
        v.string(),
        v.minLength(1),
        v.description("What the assignee should do, in full"),
      ),
      assignee: v.pipe(
        v.optional(v.string()),
        v.description("Staff id to assign to; defaults to you"),
      ),
      deadline_seconds: v.pipe(
        v.optional(v.number()),
        v.description("Optional: fail-safe deadline. The job escalates if not done in time."),
      ),
      report_when: v.pipe(
        v.optional(v.picklist(["always", "on_request"])),
        v.description(
          "'always' (default) reports the result back to this chat when done. 'on_request' runs silently — the assignee only reports if there's something worth surfacing. Use 'on_request' for a watch-and-tell-me-if job.",
        ),
      ),
    }),
    run: async ({ data }) => {
      const { title, instruction, assignee, deadline_seconds, report_when } = data
      if (assignee && !knownAgent(context.tenantId, assignee)) {
        return `No such staff member "${assignee}". Use list_jobs or ask for the roster.`
      }
      try {
        const job = getJobsCoordinator().create({
          tenantId: context.tenantId,
          title,
          instruction,
          actor: actorOf(context),
          originatorAgent: context.agent,
          originatorSession: context.session,
          assignee,
          deadlineAt: deadlineAtFrom(deadline_seconds),
          reportMode: report_when,
        })
        return `Opened job #${job.id} "${job.title}", assigned to ${job.assigneeAgent}.`
      } catch (error) {
        const cap = capMessage(error)
        if (cap) return `Could not open the job: ${cap}`
        throw error
      }
    },
  })
}

function makeListJobs(context: JobToolContext) {
  return defineTool({
    name: "list_jobs",
    description:
      "List the jobs a staff member holds (newest first), with id, state, and title. Defaults to your own; pass an agent id to see someone else's.",
    input: v.object({
      agent: v.pipe(
        v.optional(v.string()),
        v.description("Staff id whose jobs to list; defaults to you"),
      ),
    }),
    run: async ({ data }) => {
      const agent = data.agent ?? context.agent
      if (!knownAgent(context.tenantId, agent)) return `No such staff member "${agent}".`
      const jobs = getJobsCoordinator().listByAssignee(context.tenantId, agent)
      if (jobs.length === 0) return `${agent} holds no jobs.`
      return [
        `Jobs held by ${agent}:`,
        ...jobs.map((job) => `#${job.id} [${job.state}] ${job.title}`),
      ].join("\n")
    },
  })
}

function makeGetJob(context: JobToolContext) {
  return defineTool({
    name: "get_job",
    description:
      "Read one job by id: its title, state, the instruction it was opened with, and closing summary.",
    input: v.object({ id: v.pipe(v.number(), v.integer(), v.description("The job id")) }),
    run: async ({ data }) => {
      const detail = getJobsCoordinator().detail(context.tenantId, data.id)
      if (!detail) return `Job #${data.id} not found.`
      return [
        `Job #${detail.id}: ${detail.title} [${detail.state}]`,
        `Assignee: ${detail.assigneeAgent ?? "—"}  Originator: ${detail.originatorAgent}`,
        `Instruction: ${detail.instruction}`,
        detail.summary ? `Summary: ${detail.summary}` : "Summary: (not closed yet)",
      ].join("\n")
    },
  })
}

function makeJobNote(jobId: number, context: JobToolContext) {
  return defineTool({
    name: "job_note",
    description: "Record a progress note on this job so its history stays complete.",
    input: v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
    run: async ({ data }) => {
      getJobsCoordinator().note(context.tenantId, jobId, actorOf(context), data.text)
      return "Noted."
    },
  })
}

function makeJobHandoff(jobId: number, context: JobToolContext) {
  return defineTool({
    name: "job_handoff",
    description:
      "Hand this job to another staff member. They receive a digest and continue it; this is the same job, not a new one.",
    input: v.object({
      to: v.pipe(v.string(), v.minLength(1), v.description("Staff id to hand off to")),
      note: v.optional(v.string()),
    }),
    run: async ({ data }) => {
      if (!knownAgent(context.tenantId, data.to)) return `No such staff member "${data.to}".`
      try {
        getJobsCoordinator().handoff(context.tenantId, jobId, data.to, actorOf(context), data.note)
        return `Handed job #${jobId} to ${data.to}.`
      } catch (error) {
        const cap = capMessage(error)
        if (cap) return `Could not hand off: ${cap}`
        throw error
      }
    },
  })
}

function makeJobSpawn(jobId: number, context: JobToolContext) {
  return defineTool({
    name: "job_spawn",
    description:
      "Open a child job under this one, for sub-work you want to delegate. If your own result depends on the children, spawn them all first and then call job_await once to block until they finish — do not close until they are back. (The `await` flag returns you to work when the last awaited child closes; job_await is the direct way to wait inline.)",
    input: v.object({
      title: v.pipe(v.string(), v.minLength(1)),
      instruction: v.pipe(v.string(), v.minLength(1)),
      assignee: v.optional(v.string()),
      await: v.optional(v.boolean()),
    }),
    run: async ({ data }) => {
      if (data.assignee && !knownAgent(context.tenantId, data.assignee)) {
        return `No such staff member "${data.assignee}".`
      }
      try {
        const child = getJobsCoordinator().create({
          tenantId: context.tenantId,
          title: data.title,
          instruction: data.instruction,
          actor: actorOf(context),
          originatorAgent: context.agent,
          originatorSession: context.session,
          assignee: data.assignee,
          parentId: jobId,
          awaited: data.await,
        })
        return `Spawned child job #${child.id}, assigned to ${child.assigneeAgent}.`
      } catch (error) {
        const cap = capMessage(error)
        if (cap) return `Could not spawn: ${cap}`
        throw error
      }
    },
  })
}

function makeJobAwait(jobId: number, context: JobToolContext) {
  return defineTool({
    name: "job_await",
    description:
      "Block until the child jobs you spawned finish, then return each one's final state and summary. Use this after job_spawn when your result depends on the children: spawn them all, then call job_await once. Waits for every open child of this job by default; pass `jobs` to wait for a subset. It times out (so a stuck child can't hang you) — if it does, you get what finished plus which are still open, and can wait again or proceed.",
    input: v.object({
      jobs: v.pipe(
        v.optional(v.array(v.number())),
        v.description("Specific child job ids to wait for; omit to wait for all open children."),
      ),
      timeout_seconds: v.pipe(
        v.optional(v.number()),
        v.description(
          `Max seconds to block. Default ${AWAIT_DEFAULT_SECONDS}, capped at ${AWAIT_MAX_SECONDS}.`,
        ),
      ),
    }),
    run: async ({ data }) => {
      const coordinator = getJobsCoordinator()
      const ids =
        data.jobs && data.jobs.length > 0
          ? data.jobs
          : coordinator
              .children(context.tenantId, jobId)
              .filter((child) => !TERMINAL_STATES.includes(child.state))
              .map((child) => child.id)
      if (ids.length === 0) return "No open child jobs to wait for."

      const seconds = Math.min(
        Math.max(data.timeout_seconds ?? AWAIT_DEFAULT_SECONDS, 1),
        AWAIT_MAX_SECONDS,
      )
      const { jobs, pending } = await coordinator.waitForJobs(context.tenantId, ids, seconds * 1000)
      return renderAwaited(jobs, pending)
    },
  })
}

function renderAwaited(jobs: Job[], pending: number[]): string {
  const lines = jobs.map(
    (job) => `- #${job.id} [${job.state}] ${job.title}: ${job.summary ?? "(no summary)"}`,
  )
  if (pending.length === 0) {
    return [`All ${jobs.length} awaited job(s) finished:`, ...lines].join("\n")
  }
  const open = pending.map((id) => `#${id}`).join(", ")
  return [
    `Timed out with ${pending.length} still open (${open}). Wait again, or proceed noting they did not finish. Results so far:`,
    ...lines,
  ].join("\n")
}

function makeJobClose(jobId: number, context: JobToolContext) {
  return defineTool({
    name: "job_close",
    description:
      "Close this job with a concise summary of what you found or did. This is the only way to finish a job. For a normal job the summary goes to whoever opened it. For a silent job (one told to report only when it finds something), set report=true to send the summary, or leave it off to close quietly.",
    input: v.object({
      summary: v.pipe(v.string(), v.minLength(1)),
      report: v.pipe(
        v.optional(v.boolean()),
        v.description(
          "For a silent job: true to notify whoever set it up, omit to close quietly. Ignored by jobs that always report.",
        ),
      ),
    }),
    run: async ({ data }) => {
      try {
        getJobsCoordinator().close(
          context.tenantId,
          jobId,
          actorOf(context),
          data.summary,
          data.report,
        )
        return `Closed job #${jobId}.`
      } catch (error) {
        const cap = capMessage(error)
        if (cap) return `Could not close: ${cap}`
        throw error
      }
    },
  })
}

function makeJobRead(jobId: number, context: JobToolContext) {
  return defineTool({
    name: "job_read",
    description: "Read this job's full record: instruction, state, and complete timeline.",
    input: v.object({}),
    run: async () => {
      const detail = getJobsCoordinator().detail(context.tenantId, jobId)
      if (!detail) return `Job #${jobId} not found.`
      const timeline = detail.entries.map((entry) => `- ${entry.kind}: ${entry.text}`).join("\n")
      return [
        `Job #${detail.id}: ${detail.title} [${detail.state}]`,
        `Assignee: ${detail.assigneeAgent ?? "—"}  Originator: ${detail.originatorAgent}`,
        `Instruction: ${detail.instruction}`,
        detail.summary ? `Summary: ${detail.summary}` : "",
        "Timeline:",
        timeline,
      ]
        .filter((line) => line !== "")
        .join("\n")
    },
  })
}

/** Turn a duration from the model into the absolute deadline the row stores. */
function deadlineAtFrom(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  return new Date(Date.now() + seconds * 1000).toISOString()
}
