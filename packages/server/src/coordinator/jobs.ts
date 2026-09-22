import {
  type Job,
  type JobActor,
  type JobDetail,
  type JobEntry,
  type JobEntryKind,
  type JobState,
  type OnOverrun,
  type ReportMode,
  Job as JobSchema,
  JobEntry as JobEntrySchema,
  TERMINAL_STATES,
  composeSessionKey,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import type { Selectable } from "kysely"
import type { JobEntryTable, JobTable } from "./schema.ts"

/**
 * Delivers a message into an agent session. Injected from `app.ts` so the
 * coordinator never imports the agent — that would be a cycle (agent → tools →
 * coordinator → agent). Same seam the scheduler uses.
 */
export type JobDispatcher = (session: string, body: string, kind: "signal" | "user") => void

/** Thrown when a loop guardrail (tree depth, open-job count) is hit. */
export class JobCapError extends Error {}

// Coordinator-enforced loop guardrails. Hitting either fails the creating tool
// call loudly rather than letting agents spawn work without bound. MAX_DEPTH is
// shared in spirit with the bus's depth cap (M4): one cascade, one number.
const MAX_DEPTH = 5
const MAX_OPEN_PER_AGENT = 10
const DIGEST_RECENT_ENTRIES = 5

/**
 * How many times recovery re-drives a job after a transient turn failure before
 * giving up and failing it. A dropped model WebSocket or a 429 usually clears on
 * the next attempt; a job that fails this many times in a row is stuck on
 * something the retry cannot fix, and failing it (restartably) beats looping.
 */
export const MAX_RECOVERY_ATTEMPTS = 3

export interface CreateJobInput {
  tenantId: string
  title: string
  instruction: string
  actor: JobActor
  originatorAgent: string
  originatorSession: string
  assignee?: string
  parentId?: number
  awaited?: boolean
  /** Absolute ISO deadline, or undefined for none. */
  deadlineAt?: string
  onOverrun?: OnOverrun
  /** How closing reports back. Defaults to `always` (a person-opened job). */
  reportMode?: ReportMode
}

/**
 * The jobs engine: the state machine, the job tree, loop caps, digests, the
 * close-notifies-originator rule, and the deadline sweep — the heart of the
 * system.
 *
 * Every method takes `tenantId` first, without exception, for the same reason
 * every store does: the failure mode is a colleague's job appearing on the
 * board, and a missing tenant predicate is easiest to catch when the parameter
 * that should have fed it is right there in the signature.
 */
export class JobsCoordinator {
  readonly #db: Database
  #dispatch: JobDispatcher | undefined
  #onTerminal: ((tenantId: string, jobId: number) => void) | undefined
  readonly #listeners = new Set<() => void>()

  constructor(db: Database) {
    this.#db = db
  }

  /** Wire how job messages reach agent sessions. Set once at boot. */
  setDispatcher(dispatch: JobDispatcher): void {
    this.#dispatch = dispatch
  }

  /**
   * Called when a job reaches a terminal state. app.ts wires this to cancel any
   * pending confirm-gate approvals for the job — so a late approval can never
   * wake a dead one (M7). Injected rather than imported to keep the coordinator
   * free of an attention dependency.
   */
  setTerminalListener(onTerminal: (tenantId: string, jobId: number) => void): void {
    this.#onTerminal = onTerminal
  }

  /** Subscribe to state changes that affect operator-facing summaries. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  // ─── Reads ─────────────────────────────────────────────────────────────────

  list(tenantId: string): Job[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("jobs")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("id", "desc"),
      )
      .map(rowToJob)
  }

  get(tenantId: string, id: number): Job | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("jobs")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return row ? rowToJob(row) : undefined
  }

  /** Every job an agent currently holds, newest first. */
  listByAssignee(tenantId: string, agent: string): Job[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("jobs")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("assignee_agent", "=", agent)
          .orderBy("id", "desc"),
      )
      .map(rowToJob)
  }

  entries(tenantId: string, jobId: number): JobEntry[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("job_entries")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("job_id", "=", jobId)
          .orderBy("id", "asc"),
      )
      .map(rowToEntry)
  }

  detail(tenantId: string, id: number): JobDetail | undefined {
    const job = this.get(tenantId, id)
    if (!job) return undefined
    return { ...job, entries: this.entries(tenantId, id), children: this.children(tenantId, id) }
  }

  /** The direct children of a job, oldest first. */
  children(tenantId: string, id: number): Job[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("jobs")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("parent_id", "=", id)
          .orderBy("id", "asc"),
      )
      .map(rowToJob)
  }

  /**
   * Resolve once every listed job is terminal, or the timeout elapses — the
   * blocking join behind the `job_await` tool, so a parent can wait for the
   * children it spawned instead of racing them. It watches the change pulse (a
   * close/fail/cancel publishes one), with the timeout as a fail-safe so a stuck
   * child can never hang the parent forever. Returns each job's final record and
   * the ids still open when it returned.
   */
  async waitForJobs(
    tenantId: string,
    ids: number[],
    timeoutMs: number,
  ): Promise<{ jobs: Job[]; pending: number[] }> {
    const snapshot = () =>
      ids.map((id) => this.get(tenantId, id)).filter((job): job is Job => job !== undefined)
    const stillOpen = () =>
      snapshot()
        .filter((job) => !TERMINAL_STATES.includes(job.state))
        .map((job) => job.id)

    if (stillOpen().length === 0) return { jobs: snapshot(), pending: [] }

    return new Promise((resolve) => {
      let unsubscribe = () => {}
      const finish = () => {
        clearTimeout(timer)
        unsubscribe()
        resolve({ jobs: snapshot(), pending: stillOpen() })
      }
      const timer = setTimeout(finish, timeoutMs)
      unsubscribe = this.subscribe(() => {
        if (stillOpen().length === 0) finish()
      })
    })
  }

  /** The Flue session a job runs in: `tenant:assignee__job-id`. */
  sessionOf(job: Job): string {
    if (!job.assigneeAgent) throw new Error(`job #${job.id} has no assignee`)
    return composeSessionKey({ tenantId: job.tenantId, agentId: job.assigneeAgent, jobId: job.id })
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  /** Open a job and dispatch it to its assignee. Enforces the loop caps. */
  create(input: CreateJobInput): Job {
    const parent =
      input.parentId === undefined ? undefined : this.get(input.tenantId, input.parentId)
    if (input.parentId !== undefined && !parent) {
      throw new JobCapError(`parent job #${input.parentId} not found`)
    }
    const depth = parent ? parent.depth + 1 : 0
    if (depth > MAX_DEPTH) throw new JobCapError(`job tree too deep (max depth ${MAX_DEPTH})`)
    const assignee = input.assignee ?? input.originatorAgent
    this.#assertOpenCapacity(input.tenantId, assignee)

    const now = new Date().toISOString()
    const id = this.#db.transaction(() => {
      const inserted = this.#db.get<{ id: number }>(
        this.#db.qb
          .insertInto("jobs")
          .values({
            tenant_id: input.tenantId,
            title: input.title,
            instruction: input.instruction,
            state: "assigned",
            originator_agent: input.originatorAgent,
            originator_session: input.originatorSession,
            assignee_agent: assignee,
            parent_id: input.parentId ?? null,
            depth,
            awaited: input.awaited ? 1 : 0,
            report_mode: input.reportMode ?? "always",
            summary: null,
            deadline_at: input.deadlineAt ?? null,
            on_overrun: input.deadlineAt ? (input.onOverrun ?? "notify") : null,
            escalated_at: null,
            attempts: 0,
            created_at: now,
            updated_at: now,
          })
          .returning("id"),
      )
      if (!inserted) throw new Error("[jobs] insert did not return an id")
      return inserted.id
    })

    const job = this.#require(input.tenantId, id)
    this.#addEntry(job, input.actor, "created", `Opened by ${input.originatorAgent}: ${job.title}`)
    this.#addEntry(job, input.actor, "assigned", `Assigned to ${assignee}`)

    if (parent) {
      this.#addEntry(parent, input.actor, "child_spawned", `Spawned child #${id}: ${job.title}`)
      if (input.awaited) this.#setState(parent, "waiting_children")
    }

    this.#dispatchTo(this.sessionOf(job), this.#digest(job), "signal")
    this.#publish()
    return this.#require(input.tenantId, id)
  }

  /** The assignee's session marks the job started (assigned → working). Idempotent. */
  markWorking(tenantId: string, id: number, actor: JobActor): void {
    const job = this.get(tenantId, id)
    if (!job || job.state !== "assigned") return
    this.#setState(job, "working")
    this.#addEntry(job, actor, "working", "Started work")
  }

  note(tenantId: string, id: number, actor: JobActor, text: string): void {
    const job = this.#requireOpen(tenantId, id)
    this.#addEntry(job, actor, "note", text)
  }

  /** Move the job to another agent, dispatching a digest to the new holder. */
  handoff(tenantId: string, id: number, to: string, actor: JobActor, note?: string): Job {
    this.#requireOpen(tenantId, id)
    this.#assertOpenCapacity(tenantId, to)
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ assignee_agent: to, state: "assigned", updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    const moved = this.#require(tenantId, id)
    this.#addEntry(moved, actor, "handed_off", `Handed to ${to}${note ? `: ${note}` : ""}`)
    this.#dispatchTo(this.sessionOf(moved), this.#digest(moved), "signal")
    this.#publish()
    return moved
  }

  /**
   * The only exit from working: write the summary and, unless suppressed, notify
   * the originator. A `reportMode: "always"` job announces by default; an
   * `on_request` job stays silent unless the assignee passes `report`. Either
   * way the summary and terminal state are recorded, and the parent (if any) is
   * still resumed — only the chat announcement is gated.
   */
  close(tenantId: string, id: number, actor: JobActor, summary: string, report?: boolean): Job {
    const job = this.#requireOpen(tenantId, id)
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ state: "done", summary, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#addEntry(job, actor, "closed", summary)
    if (report ?? job.reportMode === "always") {
      this.#dispatchTo(
        job.originatorSession,
        `Job #${id} "${job.title}" done: ${summary}`,
        "signal",
      )
    } else {
      this.#addEntry(job, actor, "note", "Closed quietly — the originator was not notified.")
    }

    if (job.parentId !== null) {
      const parent = this.get(tenantId, job.parentId)
      if (parent) this.#addEntry(parent, actor, "child_done", `Child #${id} done: ${summary}`)
      this.#resumeParentIfReady(tenantId, job.parentId, actor)
    }
    this.#notifyTerminal(tenantId, id)
    this.#publish()
    return this.#require(tenantId, id)
  }

  /**
   * Infrastructure failed the job, so no agent tool is around to close it: a
   * dispatch rejected before the agent ran, or the Flue submission crashed
   * mid-turn. Persist that as terminal rather than stranding the job forever.
   * Idempotent: a job already terminal is left as it is.
   */
  fail(tenantId: string, id: number, reason: string): Job | undefined {
    const job = this.get(tenantId, id)
    if (!job || TERMINAL_STATES.includes(job.state)) return job
    const summary =
      job.state === "assigned" ? `Job could not start: ${reason}` : `Job failed: ${reason}`
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ state: "failed", summary, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    const actor: JobActor = { kind: "agent", id: job.assigneeAgent ?? job.originatorAgent }
    this.#addEntry(job, actor, "failed", summary)
    // A failed awaited child must not strand its parent in `waiting_children`.
    if (job.parentId !== null) {
      const parent = this.get(tenantId, job.parentId)
      if (parent) this.#addEntry(parent, actor, "child_failed", `Child #${id} failed: ${reason}`)
      this.#resumeParentIfReady(tenantId, job.parentId, actor)
    }
    this.#publish()
    return this.#require(tenantId, id)
  }

  /**
   * Re-run a job that is not progressing: a `failed` job, or one still stuck in
   * `assigned` whose kickoff never landed (a crash before the first turn, or no
   * model credential at the time it was first dispatched). Either way, reset to
   * `assigned` and re-dispatch the digest so the assignee gets another kick.
   */
  restart(tenantId: string, id: number, actor: JobActor): Job {
    const job = this.#require(tenantId, id)
    if (job.state !== "failed" && job.state !== "assigned") {
      throw new JobCapError(`job #${id} is ${job.state}; only a failed or assigned job can restart`)
    }
    if (!job.assigneeAgent) throw new JobCapError(`job #${id} has no assignee to restart`)
    this.#assertOpenCapacity(tenantId, job.assigneeAgent)
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({
          state: "assigned",
          summary: null,
          attempts: 0,
          updated_at: new Date().toISOString(),
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    const restarted = this.#require(tenantId, id)
    this.#addEntry(restarted, actor, "restarted", `Restarted; re-assigned to ${job.assigneeAgent}`)
    this.#dispatchTo(this.sessionOf(restarted), this.#digest(restarted), "signal")
    this.#publish()
    return restarted
  }

  /**
   * Re-drive a job whose turn died on a transient infrastructure failure — a
   * dropped model WebSocket, a 429 — that Flue's submission loop will not retry
   * on its own. Unlike {@link restart} this is automatic (the recovery observer
   * calls it) and does not reset state: the job stays where it was and the
   * digest re-dispatch resumes the same session. Bumps `attempts` so the caller
   * can stop after {@link MAX_RECOVERY_ATTEMPTS}. A terminal job, or one with no
   * assignee to re-dispatch to, is left alone. Returns the job's attempt count
   * after the bump, or undefined when there was nothing to recover.
   */
  recover(tenantId: string, id: number, reason: string): number | undefined {
    const job = this.get(tenantId, id)
    if (!job || TERMINAL_STATES.includes(job.state) || !job.assigneeAgent) return undefined
    const attempts = job.attempts + 1
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ attempts, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    const actor: JobActor = { kind: "system" }
    this.#addEntry(
      job,
      actor,
      "recovered",
      `Turn failed (${reason}); re-driving (attempt ${attempts} of ${MAX_RECOVERY_ATTEMPTS}).`,
    )
    this.#dispatchTo(this.sessionOf(job), this.#digest(job), "signal")
    this.#publish()
    return attempts
  }

  /**
   * Zero a job's recovery counter after a turn settles cleanly, so `attempts`
   * counts consecutive failures rather than lifetime ones. A no-op when already
   * zero, so a clean turn on a job that never failed writes nothing.
   */
  resetAttempts(tenantId: string, id: number): void {
    const job = this.get(tenantId, id)
    if (!job || job.attempts === 0) return
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ attempts: 0, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
  }

  pause(tenantId: string, id: number, actor: JobActor): Job {
    const job = this.#requireOpen(tenantId, id)
    this.#setState(job, "paused")
    this.#addEntry(job, actor, "paused", "Paused by operator")
    return this.#require(tenantId, id)
  }

  resume(tenantId: string, id: number, actor: JobActor): Job {
    const job = this.#require(tenantId, id)
    if (job.state !== "paused") throw new JobCapError(`job #${id} is not paused`)
    this.#setState(job, "working")
    this.#addEntry(job, actor, "resumed", "Resumed by operator")
    this.#dispatchTo(
      this.sessionOf(job),
      "Resumed. Re-check the latest guidance and continue.",
      "signal",
    )
    return this.#require(tenantId, id)
  }

  /** Post an operator message into the job session (steering). */
  steer(tenantId: string, id: number, actor: JobActor, message: string): Job {
    const job = this.#requireOpen(tenantId, id)
    this.#addEntry(job, actor, "steer", message)
    this.#dispatchTo(this.sessionOf(job), message, "user")
    return this.#require(tenantId, id)
  }

  /**
   * Record that the operator hard-stopped the job (the abort itself is the
   * caller's). The operator's decision is final: the job leaves the working set
   * even if Flue has already died.
   */
  recordStop(tenantId: string, id: number, actor: JobActor): Job {
    const job = this.#requireOpen(tenantId, id)
    const summary = "Stopped by operator."
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ state: "cancelled", summary, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#addEntry(job, actor, "stopped", "Operator aborted in-flight work")
    this.#addEntry(job, actor, "cancelled", summary)
    // A cancelled awaited child must not strand its parent in `waiting_children`.
    if (job.parentId !== null) this.#resumeParentIfReady(tenantId, job.parentId, actor)
    this.#notifyTerminal(tenantId, id)
    this.#publish()
    return this.#require(tenantId, id)
  }

  // ─── Deadlines ─────────────────────────────────────────────────────────────

  /** Set or replace an absolute deadline. Clears `escalatedAt` so it can fire again. */
  setDeadline(
    tenantId: string,
    id: number,
    actor: JobActor,
    deadlineAt: string,
    onOverrun: OnOverrun = "notify",
  ): Job {
    const job = this.#requireOpen(tenantId, id)
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({
          deadline_at: deadlineAt,
          on_overrun: onOverrun,
          escalated_at: null,
          updated_at: new Date().toISOString(),
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#addEntry(
      job,
      actor,
      "deadline_set",
      `Deadline set to ${deadlineAt} (${onOverrun} on overrun)`,
    )
    return this.#require(tenantId, id)
  }

  clearDeadline(tenantId: string, id: number, actor: JobActor): Job {
    const job = this.#requireOpen(tenantId, id)
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({
          deadline_at: null,
          on_overrun: null,
          escalated_at: null,
          updated_at: new Date().toISOString(),
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#addEntry(job, actor, "deadline_set", "Deadline cleared")
    return this.#require(tenantId, id)
  }

  /**
   * Re-dispatch every job still in `assigned` — the kickoff that moves it to
   * `working` never landed. A job is born `assigned` and left only when its
   * first turn runs (`markWorking` in the render); if that turn was lost — the
   * process crashed between admission and the first turn, or the assignee could
   * not resolve a model credential and the render bailed before marking working
   * — the job sits `assigned` forever with nothing to re-drive it. Called once
   * at boot (after the runtime is configured), so a restart re-drives that work.
   *
   * Spans every tenant, like {@link sweepDeadlines}: it is a system recovery,
   * not one tenant's request. Returns the ids it re-dispatched, for the caller.
   */
  redispatchAssigned(): number[] {
    const stuck = this.#db
      .all(this.#db.qb.selectFrom("jobs").selectAll().where("state", "=", "assigned"))
      .map(rowToJob)
    for (const job of stuck) this.#dispatchTo(this.sessionOf(job), this.#digest(job), "signal")
    return stuck.map((job) => job.id)
  }

  /**
   * Escalate every job past its deadline, exactly once each. Called on an
   * interval (the scheduler owns the timer, M4); pure of the clock so a test
   * passes its own `now`.
   *
   * `paused` is excluded on purpose — a paused job is one the operator is
   * already holding, and escalating it would nag the person who pressed pause.
   * Returns the ids it escalated, for the caller to log.
   */
  sweepDeadlines(now: string = new Date().toISOString()): number[] {
    const due = this.#db
      .all(
        this.#db.qb
          .selectFrom("jobs")
          .selectAll()
          .where("deadline_at", "is not", null)
          .where("escalated_at", "is", null)
          .where("deadline_at", "<=", now)
          .where("state", "in", ["assigned", "working", "waiting_children"]),
      )
      .map(rowToJob)

    for (const job of due) this.#escalate(job, now)
    return due.map((job) => job.id)
  }

  #escalate(job: Job, now: string): void {
    // Mark it escalated first, so a crashed sweep cannot double-fire.
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ escalated_at: now, updated_at: now })
        .where("tenant_id", "=", job.tenantId)
        .where("id", "=", job.id),
    )
    const actor: JobActor = { kind: "system" }

    if (job.onOverrun === "fail") {
      const summary = `Job failed: missed its deadline (${job.deadlineAt}).`
      this.#db.run(
        this.#db.qb
          .updateTable("jobs")
          .set({ state: "failed", summary, updated_at: now })
          .where("tenant_id", "=", job.tenantId)
          .where("id", "=", job.id),
      )
      this.#addEntry(job, actor, "escalated", summary)
      this.#addEntry(job, actor, "failed", summary)
      this.#notifyTerminal(job.tenantId, job.id)
    } else {
      const message = `Job #${job.id} "${job.title}" has passed its deadline (${job.deadlineAt}) and is still ${job.state}.`
      this.#addEntry(job, actor, "escalated", message)
      this.#dispatchTo(job.originatorSession, message, "signal")
    }
    this.#publish()
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  #digest(job: Job): string {
    const recent = this.entries(job.tenantId, job.id).slice(-DIGEST_RECENT_ENTRIES)
    const lines = recent.map((entry) => `- ${entry.kind}: ${entry.text}`).join("\n")
    const closing =
      job.reportMode === "on_request"
        ? "Work this job with your tools. Record progress with job_note. This job is silent by default: when you finish, call job_close with a concise summary, and set report=true only if there is something worth surfacing to whoever set it up — otherwise it closes without notifying anyone."
        : "Work this job with your tools. Record progress with job_note, and when you are done call job_close with a concise summary."
    return [
      `Job #${job.id}: ${job.title}`,
      `From: ${job.originatorAgent}`,
      "",
      job.instruction,
      "",
      "Recent activity:",
      lines,
      "",
      closing,
    ].join("\n")
  }

  /**
   * Return an awaiting parent to `working` — but only once its *last* awaited
   * child has settled. A parent that spawned several awaited children would
   * otherwise wake on the first and could proceed before the rest returned
   * (the bug that let a summary close before a sibling job came back). A child
   * that fails or is cancelled counts as settled too, so a stuck child cannot
   * strand the parent in `waiting_children` forever.
   */
  #resumeParentIfReady(tenantId: string, parentId: number, actor: JobActor): void {
    const parent = this.get(tenantId, parentId)
    if (!parent || parent.state !== "waiting_children") return
    if (this.#hasOpenAwaitedChildren(tenantId, parentId)) return
    this.#setState(parent, "working")
    this.#dispatchTo(
      this.sessionOf(parent),
      "Every awaited child job has finished. Review their results and continue.",
      "signal",
    )
    this.#addEntry(parent, actor, "children_done", "All awaited children finished")
  }

  #hasOpenAwaitedChildren(tenantId: string, parentId: number): boolean {
    const row = this.#db.get<{ open: number }>(
      this.#db.qb
        .selectFrom("jobs")
        .select((eb) => eb.fn.countAll<number>().as("open"))
        .where("tenant_id", "=", tenantId)
        .where("parent_id", "=", parentId)
        .where("awaited", "=", 1)
        .where("state", "not in", ["done", "failed", "cancelled"]),
    )
    return row ? Number(row.open) > 0 : false
  }

  #dispatchTo(session: string, body: string, kind: "signal" | "user"): void {
    if (!this.#dispatch) throw new Error("[jobs] dispatcher not configured")
    this.#dispatch(session, body, kind)
  }

  #assertOpenCapacity(tenantId: string, agent: string): void {
    const row = this.#db.get<{ open: number }>(
      this.#db.qb
        .selectFrom("jobs")
        .select((eb) => eb.fn.countAll<number>().as("open"))
        .where("tenant_id", "=", tenantId)
        .where("assignee_agent", "=", agent)
        .where("state", "not in", ["done", "failed", "cancelled"]),
    )
    const open = row ? Number(row.open) : 0
    if (open >= MAX_OPEN_PER_AGENT) {
      throw new JobCapError(`${agent} already holds ${open} open jobs (max ${MAX_OPEN_PER_AGENT})`)
    }
  }

  #requireOpen(tenantId: string, id: number): Job {
    const job = this.#require(tenantId, id)
    if (TERMINAL_STATES.includes(job.state)) {
      throw new JobCapError(`job #${id} is ${job.state} and cannot change`)
    }
    return job
  }

  #require(tenantId: string, id: number): Job {
    const job = this.get(tenantId, id)
    if (!job) throw new JobCapError(`job #${id} not found`)
    return job
  }

  #setState(job: Job, state: JobState): void {
    this.#db.run(
      this.#db.qb
        .updateTable("jobs")
        .set({ state, updated_at: new Date().toISOString() })
        .where("tenant_id", "=", job.tenantId)
        .where("id", "=", job.id),
    )
    this.#publish()
  }

  #publish(): void {
    for (const listener of this.#listeners) listener()
  }

  #notifyTerminal(tenantId: string, jobId: number): void {
    this.#onTerminal?.(tenantId, jobId)
  }

  #addEntry(job: Job, actor: JobActor, kind: JobEntryKind, text: string): void {
    this.#db.run(
      this.#db.qb.insertInto("job_entries").values({
        job_id: job.id,
        tenant_id: job.tenantId,
        ts: new Date().toISOString(),
        actor_kind: actor.kind,
        actor_id: actor.kind === "agent" ? actor.id : null,
        kind,
        text,
      }),
    )
  }
}

function rowToJob(row: Selectable<JobTable>): Job {
  return JobSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    instruction: row.instruction,
    state: row.state,
    originatorAgent: row.originator_agent,
    originatorSession: row.originator_session,
    assigneeAgent: row.assignee_agent ?? null,
    parentId: row.parent_id ?? null,
    depth: row.depth,
    awaited: row.awaited === 1,
    reportMode: row.report_mode,
    summary: row.summary ?? null,
    deadlineAt: row.deadline_at ?? null,
    onOverrun: row.on_overrun ?? null,
    escalatedAt: row.escalated_at ?? null,
    attempts: row.attempts ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function rowToEntry(row: Selectable<JobEntryTable>): JobEntry {
  return JobEntrySchema.parse({
    id: row.id,
    jobId: row.job_id,
    timestamp: row.ts,
    actor:
      row.actor_kind === "agent" ? { kind: "agent", id: row.actor_id } : { kind: row.actor_kind },
    kind: row.kind,
    text: row.text,
  })
}

let coordinator: JobsCoordinator | undefined

/** The process-wide jobs coordinator, opened lazily on first use. */
export function getJobsCoordinator(): JobsCoordinator {
  if (!coordinator) coordinator = new JobsCoordinator(getDatabase())
  return coordinator
}
