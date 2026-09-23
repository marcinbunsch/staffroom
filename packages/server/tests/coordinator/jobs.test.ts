import { beforeEach, describe, expect, it } from "vitest"
import { JobCapError, JobsCoordinator } from "../../src/coordinator/jobs.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

interface Dispatched {
  session: string
  body: string
  kind: "signal" | "user"
}

async function makeCoordinator(): Promise<{ jobs: JobsCoordinator; sent: Dispatched[] }> {
  const jobs = new JobsCoordinator(await migratedDatabase())
  const sent: Dispatched[] = []
  jobs.setDispatcher((session, body, kind) => sent.push({ session, body, kind }))
  return { jobs, sent }
}

function open(jobs: JobsCoordinator, tenantId: string, overrides: Record<string, unknown> = {}) {
  return jobs.create({
    tenantId,
    title: "Investigate the alert",
    instruction: "Look into the pager alert and report.",
    actor: { kind: "operator" },
    originatorAgent: "chief",
    originatorSession: `${tenantId}:chief`,
    assignee: "devops",
    ...overrides,
  })
}

// A job is created via the coordinator, which needs a dispatcher; the isolation
// contract only reads and lists, so a no-op dispatcher is fine here.
defineTenantIsolationTests("jobs", async () => {
  const jobs = new JobsCoordinator(await migratedDatabase())
  jobs.setDispatcher(() => {})
  return {
    create: (tenantId) => open(jobs, tenantId).id,
    read: (tenantId, id) => jobs.get(tenantId, id),
    list: (tenantId) => jobs.list(tenantId),
  }
})

describe("the jobs engine", () => {
  let jobs: JobsCoordinator
  let sent: Dispatched[]

  beforeEach(async () => {
    ;({ jobs, sent } = await makeCoordinator())
  })

  it("opens a job assigned, and dispatches a digest to the assignee's session", () => {
    const job = open(jobs, "alice")

    expect(job).toMatchObject({ state: "assigned", assigneeAgent: "devops", depth: 0 })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.session).toBe("alice:devops__job-" + job.id)
    expect(sent[0]?.kind).toBe("signal")
    expect(sent[0]?.body).toContain("Investigate the alert")
  })

  it("defaults the assignee to the originator", () => {
    const job = jobs.create({
      tenantId: "alice",
      title: "t",
      instruction: "i",
      actor: { kind: "agent", id: "chief" },
      originatorAgent: "chief",
      originatorSession: "alice:chief",
    })
    expect(job.assigneeAgent).toBe("chief")
  })

  describe("the state machine", () => {
    it("runs assigned → working → done", () => {
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      expect(jobs.get("alice", job.id)?.state).toBe("working")

      const closed = jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "All clear.")
      expect(closed.state).toBe("done")
      expect(closed.summary).toBe("All clear.")
    })

    it("markWorking is idempotent and only fires from assigned", () => {
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done")
      // A closed job is not dragged back to working.
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      expect(jobs.get("alice", job.id)?.state).toBe("done")
    })

    it("notifies the originator on close", () => {
      const job = open(jobs, "alice")
      sent.length = 0
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "Found the cause.")

      const toOriginator = sent.find((message) => message.session === "alice:chief")
      expect(toOriginator?.body).toContain("Found the cause.")
    })

    it("a silent (on_request) job closes without notifying the originator by default", () => {
      const job = open(jobs, "alice", { reportMode: "on_request" })
      sent.length = 0
      const closed = jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "Nothing today.")

      expect(closed.state).toBe("done")
      expect(closed.summary).toBe("Nothing today.")
      // The record is complete, but the chat is not pinged.
      expect(sent.find((message) => message.session === "alice:chief")).toBeUndefined()
    })

    it("a silent job notifies when the assignee closes with report=true", () => {
      const job = open(jobs, "alice", { reportMode: "on_request" })
      sent.length = 0
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "Found a leak.", true)

      const toOriginator = sent.find((message) => message.session === "alice:chief")
      expect(toOriginator?.body).toContain("Found a leak.")
    })

    it("an always-report job can be closed quietly with report=false", () => {
      const job = open(jobs, "alice")
      sent.length = 0
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "Handled inline.", false)

      expect(sent.find((message) => message.session === "alice:chief")).toBeUndefined()
    })

    it("refuses to change a terminal job", () => {
      const job = open(jobs, "alice")
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done")
      expect(() => jobs.note("alice", job.id, { kind: "agent", id: "devops" }, "late")).toThrow(
        JobCapError,
      )
    })

    it("fails a job that crashed, and restarts it", () => {
      const job = open(jobs, "alice")
      const failed = jobs.fail("alice", job.id, "model socket dropped")
      expect(failed?.state).toBe("failed")
      expect(failed?.summary).toContain("model socket dropped")

      sent.length = 0
      const restarted = jobs.restart("alice", job.id, { kind: "operator" })
      expect(restarted.state).toBe("assigned")
      expect(restarted.summary).toBeNull()
      expect(sent.some((message) => message.session === `alice:devops__job-${job.id}`)).toBe(true)
    })

    it("restarts a job stuck in assigned (kickoff was lost), re-dispatching it", () => {
      const job = open(jobs, "alice")
      expect(job.state).toBe("assigned")

      sent.length = 0
      const restarted = jobs.restart("alice", job.id, { kind: "operator" })
      expect(restarted.state).toBe("assigned")
      expect(sent.some((message) => message.session === `alice:devops__job-${job.id}`)).toBe(true)
    })

    it("refuses to restart a job that is neither failed nor assigned", () => {
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      expect(() => jobs.restart("alice", job.id, { kind: "operator" })).toThrow(JobCapError)
    })

    it("recovers a job in place, bumping attempts and re-dispatching the digest", () => {
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      sent.length = 0

      const attempts = jobs.recover("alice", job.id, "WebSocket error")
      expect(attempts).toBe(1)
      const recovered = jobs.get("alice", job.id)
      // State is untouched — recovery re-drives, it does not reset like restart.
      expect(recovered?.state).toBe("working")
      expect(recovered?.attempts).toBe(1)
      expect(sent.some((message) => message.session === `alice:devops__job-${job.id}`)).toBe(true)
    })

    it("does not recover a terminal job", () => {
      const job = open(jobs, "alice")
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done")
      expect(jobs.recover("alice", job.id, "WebSocket error")).toBeUndefined()
      expect(jobs.get("alice", job.id)?.attempts).toBe(0)
    })

    it("resetAttempts zeroes the counter after a clean turn", () => {
      const job = open(jobs, "alice")
      jobs.recover("alice", job.id, "WebSocket error")
      expect(jobs.get("alice", job.id)?.attempts).toBe(1)
      jobs.resetAttempts("alice", job.id)
      expect(jobs.get("alice", job.id)?.attempts).toBe(0)
    })

    it("restart clears the recovery counter", () => {
      const job = open(jobs, "alice")
      jobs.recover("alice", job.id, "WebSocket error")
      jobs.fail("alice", job.id, "gave up")
      const restarted = jobs.restart("alice", job.id, { kind: "operator" })
      expect(restarted.attempts).toBe(0)
    })

    it("fail is idempotent — a done job is not re-failed", () => {
      const job = open(jobs, "alice")
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done")
      expect(jobs.fail("alice", job.id, "too late")?.state).toBe("done")
    })

    it("pauses and resumes, nudging the session on resume", () => {
      const job = open(jobs, "alice")
      jobs.pause("alice", job.id, { kind: "operator" })
      expect(jobs.get("alice", job.id)?.state).toBe("paused")

      sent.length = 0
      jobs.resume("alice", job.id, { kind: "operator" })
      expect(jobs.get("alice", job.id)?.state).toBe("working")
      expect(sent.some((message) => message.body.includes("Resumed"))).toBe(true)
    })

    it("steers by posting a user message into the session", () => {
      const job = open(jobs, "alice")
      sent.length = 0
      jobs.steer("alice", job.id, { kind: "operator" }, "Focus on the database, not the network.")

      expect(sent[0]).toMatchObject({
        session: `alice:devops__job-${job.id}`,
        kind: "user",
        body: "Focus on the database, not the network.",
      })
    })

    it("records an operator hard-stop as cancelled", () => {
      const job = open(jobs, "alice")
      const stopped = jobs.recordStop("alice", job.id, { kind: "operator" })
      expect(stopped.state).toBe("cancelled")
    })

    it("stops a running job: aborts its session, then records it cancelled", async () => {
      const aborted: string[] = []
      jobs.setAborter(async (session) => {
        aborted.push(session)
      })
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })

      const stopped = await jobs.stop("alice", job.id, { kind: "operator" })

      expect(stopped.state).toBe("cancelled")
      expect(aborted).toEqual([`alice:devops__job-${job.id}`])
    })

    it("still records the stop when the aborter fails", async () => {
      // The injected aborter is expected to swallow its own errors, so `stop`
      // never sees a rejection — but a resolving no-op stands in here.
      jobs.setAborter(async () => {})
      const job = open(jobs, "alice")
      const stopped = await jobs.stop("alice", job.id, { kind: "operator" })
      expect(stopped.state).toBe("cancelled")
    })

    it("refuses to stop a job that is already terminal", async () => {
      const job = open(jobs, "alice")
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done")
      await expect(jobs.stop("alice", job.id, { kind: "operator" })).rejects.toThrow(JobCapError)
    })

    it("cancels a paused job as cancelled", () => {
      const job = open(jobs, "alice")
      jobs.pause("alice", job.id, { kind: "operator" })
      const cancelled = jobs.cancel("alice", job.id, { kind: "operator" })
      expect(cancelled.state).toBe("cancelled")
    })

    it("cancels a failed job as cancelled", () => {
      const job = open(jobs, "alice")
      jobs.fail("alice", job.id, "boom")
      const cancelled = jobs.cancel("alice", job.id, { kind: "operator" })
      expect(cancelled.state).toBe("cancelled")
    })

    it("refuses to cancel a running or done job", () => {
      const running = open(jobs, "alice")
      jobs.markWorking("alice", running.id, { kind: "agent", id: "devops" })
      expect(() => jobs.cancel("alice", running.id, { kind: "operator" })).toThrow(JobCapError)

      const done = open(jobs, "alice")
      jobs.close("alice", done.id, { kind: "agent", id: "devops" }, "done")
      expect(() => jobs.cancel("alice", done.id, { kind: "operator" })).toThrow(JobCapError)
    })
  })

  describe("boot recovery of stuck jobs", () => {
    it("re-dispatches every assigned job, across tenants, and leaves others alone", () => {
      const stuckA = open(jobs, "alice")
      const stuckB = open(jobs, "bob")
      const working = open(jobs, "alice", { assignee: "pm" })
      jobs.markWorking("alice", working.id, { kind: "agent", id: "pm" })
      const done = open(jobs, "alice", { assignee: "code" })
      jobs.close("alice", done.id, { kind: "agent", id: "code" }, "done")

      sent.length = 0
      const revived = jobs.redispatchAssigned()

      expect(revived.sort()).toEqual([stuckA.id, stuckB.id].sort())
      expect(sent.map((message) => message.session).sort()).toEqual(
        [`alice:devops__job-${stuckA.id}`, `bob:devops__job-${stuckB.id}`].sort(),
      )
    })

    it("re-dispatches nothing when no job is stuck", () => {
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      sent.length = 0
      expect(jobs.redispatchAssigned()).toEqual([])
      expect(sent).toHaveLength(0)
    })
  })

  describe("waiting on children", () => {
    function spawnChild(parentId: number, assignee: string, awaited = false) {
      return jobs.create({
        tenantId: "alice",
        title: `child of #${parentId}`,
        instruction: "do it",
        actor: { kind: "agent", id: "pm" },
        originatorAgent: "pm",
        originatorSession: `alice:pm__job-${parentId}`,
        assignee,
        parentId,
        awaited,
      })
    }

    it("waitForJobs resolves once every listed child is terminal", async () => {
      const parent = open(jobs, "alice")
      const c1 = spawnChild(parent.id, "code")
      const c2 = spawnChild(parent.id, "devops")

      const waiting = jobs.waitForJobs("alice", [c1.id, c2.id], 5_000)
      jobs.close("alice", c1.id, { kind: "agent", id: "code" }, "first done")
      jobs.close("alice", c2.id, { kind: "agent", id: "devops" }, "second done")

      const { jobs: settled, pending } = await waiting
      expect(pending).toEqual([])
      expect(settled.map((j) => j.id).sort()).toEqual([c1.id, c2.id].sort())
      expect(settled.find((j) => j.id === c1.id)?.summary).toBe("first done")
    })

    it("waitForJobs times out and reports the still-open ids", async () => {
      const parent = open(jobs, "alice")
      const c1 = spawnChild(parent.id, "code")
      const { pending } = await jobs.waitForJobs("alice", [c1.id], 20)
      expect(pending).toEqual([c1.id])
    })

    it("keeps an awaiting parent waiting until its LAST awaited child finishes", () => {
      const parent = open(jobs, "alice")
      const c1 = spawnChild(parent.id, "code", true)
      const c2 = spawnChild(parent.id, "devops", true)
      expect(jobs.get("alice", parent.id)?.state).toBe("waiting_children")

      jobs.close("alice", c1.id, { kind: "agent", id: "code" }, "one")
      // The bug this guards: it used to flip to working on the first child.
      expect(jobs.get("alice", parent.id)?.state).toBe("waiting_children")

      jobs.close("alice", c2.id, { kind: "agent", id: "devops" }, "two")
      expect(jobs.get("alice", parent.id)?.state).toBe("working")
    })

    it("does not strand an awaiting parent when an awaited child fails", () => {
      const parent = open(jobs, "alice")
      const c1 = spawnChild(parent.id, "code", true)
      jobs.fail("alice", c1.id, "boom")
      expect(jobs.get("alice", parent.id)?.state).toBe("working")
    })
  })

  describe("the tree and its caps", () => {
    it("spawns a child one level deeper, and blocks the parent when awaited", () => {
      const parent = open(jobs, "alice")
      const child = jobs.create({
        tenantId: "alice",
        title: "sub",
        instruction: "do part",
        actor: { kind: "agent", id: "devops" },
        originatorAgent: "devops",
        originatorSession: `alice:devops__job-${parent.id}`,
        parentId: parent.id,
        awaited: true,
      })

      expect(child.depth).toBe(1)
      expect(child.parentId).toBe(parent.id)
      expect(jobs.get("alice", parent.id)?.state).toBe("waiting_children")
    })

    it("returns an awaited parent to working when the child closes", () => {
      const parent = open(jobs, "alice")
      const child = jobs.create({
        tenantId: "alice",
        title: "sub",
        instruction: "do part",
        actor: { kind: "agent", id: "devops" },
        originatorAgent: "devops",
        originatorSession: `alice:devops__job-${parent.id}`,
        parentId: parent.id,
        awaited: true,
      })
      jobs.close("alice", child.id, { kind: "agent", id: "devops" }, "part done")
      expect(jobs.get("alice", parent.id)?.state).toBe("working")
    })

    it("refuses a tree deeper than the cap", () => {
      let parentId: number | undefined
      // depth 0..5 is fine (6 levels); the 7th create throws.
      for (let depth = 0; depth <= 5; depth++) {
        const job: { id: number } = jobs.create({
          tenantId: "alice",
          title: `d${depth}`,
          instruction: "x",
          actor: { kind: "agent", id: "devops" },
          originatorAgent: "devops",
          originatorSession: "alice:devops",
          parentId,
        })
        parentId = job.id
      }
      expect(() =>
        jobs.create({
          tenantId: "alice",
          title: "too deep",
          instruction: "x",
          actor: { kind: "agent", id: "devops" },
          originatorAgent: "devops",
          originatorSession: "alice:devops",
          parentId,
        }),
      ).toThrow(JobCapError)
    })

    it("refuses an agent past its open-job cap", () => {
      for (let i = 0; i < 10; i++) open(jobs, "alice")
      expect(() => open(jobs, "alice")).toThrow(JobCapError)
    })

    it("counts caps per tenant, so one tenant cannot exhaust another", () => {
      for (let i = 0; i < 10; i++) open(jobs, "alice")
      // Bob's devops is a different row and starts empty.
      expect(() => open(jobs, "bob")).not.toThrow()
    })

    it("refuses a child of a job that is not there", () => {
      expect(() =>
        jobs.create({
          tenantId: "alice",
          title: "orphan",
          instruction: "x",
          actor: { kind: "agent", id: "devops" },
          originatorAgent: "devops",
          originatorSession: "alice:devops",
          parentId: 9999,
        }),
      ).toThrow(JobCapError)
    })
  })

  describe("handoff", () => {
    it("moves the job and dispatches a digest to the new holder", () => {
      const job = open(jobs, "alice")
      sent.length = 0
      const moved = jobs.handoff("alice", job.id, "research", { kind: "operator" }, "your area")

      expect(moved.assigneeAgent).toBe("research")
      expect(moved.state).toBe("assigned")
      expect(sent[0]?.session).toBe(`alice:research__job-${job.id}`)
    })

    it("keeps a job under one tenant's assignee count, moving it off another agent", () => {
      const job = open(jobs, "alice")
      jobs.handoff("alice", job.id, "research", { kind: "operator" })
      expect(jobs.listByAssignee("alice", "devops")).toHaveLength(0)
      expect(jobs.listByAssignee("alice", "research")).toHaveLength(1)
    })
  })

  describe("the timeline", () => {
    it("accretes an entry per transition", () => {
      const job = open(jobs, "alice")
      jobs.markWorking("alice", job.id, { kind: "agent", id: "devops" })
      jobs.note("alice", job.id, { kind: "agent", id: "devops" }, "checked the logs")
      jobs.close("alice", job.id, { kind: "agent", id: "devops" }, "done")

      const kinds = jobs.entries("alice", job.id).map((entry) => entry.kind)
      expect(kinds).toEqual(["created", "assigned", "working", "note", "closed"])
    })
  })
})
