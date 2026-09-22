import { beforeEach, describe, expect, it } from "vitest"
import { JobsCoordinator } from "../../src/coordinator/jobs.ts"
import { migratedDatabase } from "../migrated-database.ts"

interface Dispatched {
  session: string
  body: string
}

const PAST = "2020-01-01T00:00:00.000Z"
const FUTURE = "2999-01-01T00:00:00.000Z"

async function makeCoordinator() {
  const jobs = new JobsCoordinator(await migratedDatabase())
  const sent: Dispatched[] = []
  jobs.setDispatcher((session, body) => sent.push({ session, body }))
  return { jobs, sent }
}

function open(jobs: JobsCoordinator, overrides: Record<string, unknown> = {}) {
  return jobs.create({
    tenantId: "alice",
    title: "Nightly digest",
    instruction: "Summarize the day.",
    actor: { kind: "scheduler" },
    originatorAgent: "chief",
    originatorSession: "alice:chief",
    assignee: "devops",
    ...overrides,
  })
}

describe("the deadline sweep", () => {
  let jobs: JobsCoordinator
  let sent: Dispatched[]

  beforeEach(async () => {
    ;({ jobs, sent } = await makeCoordinator())
  })

  it("escalates a job past its deadline, once", () => {
    const job = open(jobs, { deadlineAt: PAST })
    sent.length = 0

    expect(jobs.sweepDeadlines()).toEqual([job.id])
    // The second sweep finds nothing: escalatedAt is set.
    expect(jobs.sweepDeadlines()).toEqual([])

    const entries = jobs.entries("alice", job.id).filter((e) => e.kind === "escalated")
    expect(entries).toHaveLength(1)
    expect(jobs.get("alice", job.id)?.escalatedAt).not.toBeNull()
  })

  it("notify posts to the originator and leaves the job running", () => {
    const job = open(jobs, { deadlineAt: PAST, onOverrun: "notify" })
    sent.length = 0
    jobs.sweepDeadlines()

    expect(jobs.get("alice", job.id)?.state).toBe("assigned")
    const message = sent.find((m) => m.session === "alice:chief")
    expect(message?.body).toContain("passed its deadline")
  })

  it("fail marks the job failed, and it becomes restartable", () => {
    const job = open(jobs, { deadlineAt: PAST, onOverrun: "fail" })
    jobs.sweepDeadlines()

    expect(jobs.get("alice", job.id)?.state).toBe("failed")
    expect(() => jobs.restart("alice", job.id, { kind: "operator" })).not.toThrow()
  })

  it("leaves a job whose deadline has not passed", () => {
    open(jobs, { deadlineAt: FUTURE })
    expect(jobs.sweepDeadlines()).toEqual([])
  })

  it("leaves a job with no deadline", () => {
    open(jobs)
    expect(jobs.sweepDeadlines()).toEqual([])
  })

  /**
   * A paused job is one the operator is already holding; escalating it would
   * nag the person who pressed pause.
   */
  it("does not escalate a paused job", () => {
    const job = open(jobs, { deadlineAt: PAST })
    jobs.pause("alice", job.id, { kind: "operator" })
    expect(jobs.sweepDeadlines()).toEqual([])
  })

  it("does not escalate a job that already finished", () => {
    const job = open(jobs, { deadlineAt: PAST })
    jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done early")
    expect(jobs.sweepDeadlines()).toEqual([])
  })

  it("escalates a waiting_children parent whose own deadline passed", () => {
    const parent = open(jobs, { deadlineAt: PAST })
    jobs.create({
      tenantId: "alice",
      title: "child",
      instruction: "x",
      actor: { kind: "agent", id: "devops" },
      originatorAgent: "devops",
      originatorSession: `alice:devops__job-${parent.id}`,
      parentId: parent.id,
      awaited: true,
    })
    expect(jobs.get("alice", parent.id)?.state).toBe("waiting_children")
    expect(jobs.sweepDeadlines()).toEqual([parent.id])
  })

  describe("operator edits", () => {
    it("sets a deadline on a running job", () => {
      const job = open(jobs)
      jobs.setDeadline("alice", job.id, { kind: "operator" }, PAST, "fail")
      expect(jobs.sweepDeadlines()).toEqual([job.id])
    })

    it("clearing a deadline stops the sweep from firing", () => {
      const job = open(jobs, { deadlineAt: PAST })
      jobs.clearDeadline("alice", job.id, { kind: "operator" })
      expect(jobs.sweepDeadlines()).toEqual([])
    })

    it("re-setting a deadline clears a prior escalation so it can fire again", () => {
      const job = open(jobs, { deadlineAt: PAST })
      jobs.sweepDeadlines()
      jobs.setDeadline("alice", job.id, { kind: "operator" }, PAST)
      expect(jobs.sweepDeadlines()).toEqual([job.id])
    })
  })

  it("only sweeps jobs across all tenants that are actually due", async () => {
    // The sweep is global (it runs for the whole process), but each escalation
    // still acts on the job's own tenant.
    const bobJob = jobs.create({
      tenantId: "bob",
      title: "bob's overdue job",
      instruction: "x",
      actor: { kind: "scheduler" },
      originatorAgent: "chief",
      originatorSession: "bob:chief",
      assignee: "devops",
      deadlineAt: PAST,
    })
    const aliceJob = open(jobs, { deadlineAt: PAST })

    expect(jobs.sweepDeadlines().sort()).toEqual([bobJob.id, aliceJob.id].sort())
    expect(jobs.get("bob", bobJob.id)?.escalatedAt).not.toBeNull()
    expect(jobs.get("alice", aliceJob.id)?.escalatedAt).not.toBeNull()
  })
})
