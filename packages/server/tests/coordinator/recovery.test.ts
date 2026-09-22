import { beforeEach, describe, expect, it } from "vitest"
import { JobsCoordinator, MAX_RECOVERY_ATTEMPTS } from "../../src/coordinator/jobs.ts"
import { backoffMs, handleEvent, isTransientDispatchError } from "../../src/coordinator/recovery.ts"
import type { FlueEvent } from "@flue/runtime"
import { migratedDatabase } from "../migrated-database.ts"

// The recovery tap only looks at a handful of FlueEvent fields; a test builds
// just those, the way flue-audit's test does.
function event(shape: Record<string, unknown>): FlueEvent {
  return shape as unknown as FlueEvent
}

async function makeCoordinator(): Promise<JobsCoordinator> {
  const jobs = new JobsCoordinator(await migratedDatabase())
  jobs.setDispatcher(() => {})
  return jobs
}

function open(jobs: JobsCoordinator, tenantId = "alice") {
  return jobs.create({
    tenantId,
    title: "Investigate the alert",
    instruction: "Look into the pager alert and report.",
    actor: { kind: "operator" },
    originatorAgent: "chief",
    originatorSession: `${tenantId}:chief`,
    assignee: "devops",
  })
}

describe("isTransientDispatchError", () => {
  it("treats dropped sockets, 429/503, and overload as transient", () => {
    for (const message of [
      "dispatch(sub_01) failed: WebSocket error",
      "read ECONNRESET",
      "socket hang up",
      "request failed with status 429",
      "503 Service Unavailable",
      "the model is overloaded",
      "network timeout",
    ]) {
      expect(isTransientDispatchError(new Error(message))).toBe(true)
    }
  })

  it("treats missing credentials, validation, and unknown shapes as permanent", () => {
    for (const message of [
      "no model credential for devops",
      "target agent is not registered",
      "invalid tool arguments",
      "job #4 already holds 10 open jobs",
    ]) {
      expect(isTransientDispatchError(new Error(message))).toBe(false)
    }
    expect(isTransientDispatchError(undefined)).toBe(false)
    expect(isTransientDispatchError({ weird: true })).toBe(false)
  })
})

describe("the recovery tap", () => {
  let jobs: JobsCoordinator
  // A synchronous timer, so a scheduled re-drive runs inline for the assertion.
  const runNow = (fn: () => void) => fn()

  beforeEach(async () => {
    jobs = await makeCoordinator()
  })

  const session = (id: number) => `alice:devops__job-${id}`
  // Flue's serialized submission error: `message` carries the failure text.
  const settledFailed = (id: number, message: string) =>
    event({
      type: "submission_settled",
      instanceId: session(id),
      submissionId: "sub_01",
      outcome: "failed",
      error: { message },
    })

  it("re-drives a job whose turn died on a transient error, bumping attempts", () => {
    const job = open(jobs)
    handleEvent(settledFailed(job.id, "dispatch(sub_01) failed: WebSocket error"), jobs, runNow)
    expect(jobs.get("alice", job.id)?.attempts).toBe(1)
    // Still non-terminal — it was re-driven, not failed.
    expect(jobs.get("alice", job.id)?.state).toBe("assigned")
  })

  it("fails the job at once on a permanent error, without retrying", () => {
    const job = open(jobs)
    handleEvent(settledFailed(job.id, "no model credential for devops"), jobs, runNow)
    expect(jobs.get("alice", job.id)?.state).toBe("failed")
    expect(jobs.get("alice", job.id)?.attempts).toBe(0)
  })

  it("gives up to a restartable failure once the attempts are exhausted", () => {
    const job = open(jobs)
    const fail = () => handleEvent(settledFailed(job.id, "WebSocket error"), jobs, runNow)
    // MAX re-drives, each bumping attempts, then one more that gives up.
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) fail()
    expect(jobs.get("alice", job.id)?.attempts).toBe(MAX_RECOVERY_ATTEMPTS)
    expect(jobs.get("alice", job.id)?.state).toBe("assigned")

    fail()
    expect(jobs.get("alice", job.id)?.state).toBe("failed")
  })

  it("resets the counter when a turn settles cleanly", () => {
    const job = open(jobs)
    handleEvent(settledFailed(job.id, "WebSocket error"), jobs, runNow)
    expect(jobs.get("alice", job.id)?.attempts).toBe(1)

    handleEvent(
      event({
        type: "submission_settled",
        instanceId: session(job.id),
        submissionId: "sub_02",
        outcome: "completed",
      }),
      jobs,
      runNow,
    )
    expect(jobs.get("alice", job.id)?.attempts).toBe(0)
  })

  it("leaves an aborted job alone — that is the operator's hard-stop path", () => {
    const job = open(jobs)
    handleEvent(
      event({
        type: "submission_settled",
        instanceId: session(job.id),
        submissionId: "sub_03",
        outcome: "aborted",
      }),
      jobs,
      runNow,
    )
    expect(jobs.get("alice", job.id)?.state).toBe("assigned")
    expect(jobs.get("alice", job.id)?.attempts).toBe(0)
  })

  it("ignores settlements for chat sessions and unparseable keys", () => {
    handleEvent(
      event({
        type: "submission_settled",
        instanceId: "alice:devops",
        submissionId: "sub_04",
        outcome: "failed",
        error: { message: "WebSocket error" },
      }),
      jobs,
      runNow,
    )
    handleEvent(
      event({
        type: "submission_settled",
        instanceId: undefined,
        submissionId: "sub_05",
        outcome: "failed",
      }),
      jobs,
      runNow,
    )
    // Nothing to assert beyond "did not throw" — there is no job to touch.
    expect(jobs.list("alice")).toHaveLength(0)
  })

  it("grows the backoff with the number of prior failures", () => {
    expect(backoffMs(0)).toBeLessThan(backoffMs(1))
    expect(backoffMs(1)).toBeLessThan(backoffMs(2))
    // Clamped at the top of the ladder, never unbounded.
    expect(backoffMs(99)).toBe(backoffMs(2))
  })
})
