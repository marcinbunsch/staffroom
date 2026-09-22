import type { ScheduleInput } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"
import { EventBus } from "../../src/coordinator/event-bus.ts"
import { ChatStore } from "../../src/coordinator/chats.ts"
import { JobsCoordinator } from "../../src/coordinator/jobs.ts"
import { SchedulesStore, scheduleSubscription } from "../../src/coordinator/schedules-store.ts"
import { Scheduler } from "../../src/coordinator/scheduler.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    title: "Daily digest",
    agent: "devops",
    instruction: "Summarize the day.",
    timing: { kind: "interval", seconds: 3600 },
    ...overrides,
  }
}

async function makeStore(): Promise<SchedulesStore> {
  return new SchedulesStore(await migratedDatabase())
}

defineTenantIsolationTests("schedules", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, title) => store.create(tenantId, input({ title })).id,
    read: (tenantId, id) => store.get(tenantId, id),
    list: (tenantId) => store.list(tenantId),
    update: (tenantId, id) => store.update(tenantId, id, { title: "renamed" }) !== undefined,
    remove: (tenantId, id) => store.remove(tenantId, id),
  }
})

describe("schedules", () => {
  it("round-trips a cron schedule", async () => {
    const store = await makeStore()
    const schedule = store.create(
      "alice",
      input({ timing: { kind: "cron", expression: "0 9 * * *" } }),
    )
    expect(store.get("alice", schedule.id)?.timing).toEqual({
      kind: "cron",
      expression: "0 9 * * *",
    })
  })

  it("round-trips a one-off schedule and starts it uncompleted", async () => {
    const store = await makeStore()
    const at = new Date(Date.now() + 3_600_000).toISOString()
    const schedule = store.create("alice", input({ timing: { kind: "once", at } }))
    expect(store.get("alice", schedule.id)?.timing).toEqual({ kind: "once", at })
    expect(schedule.completedAt).toBeNull()
  })

  it("advances the cursor on fire without touching updatedAt", async () => {
    const store = await makeStore()
    const schedule = store.create("alice", input())
    const before = store.get("alice", schedule.id)!.updatedAt

    store.markFired("alice", schedule.id, "2026-09-02T09:00:00.000Z")
    const after = store.get("alice", schedule.id)!
    expect(after.lastFiredAt).toBe("2026-09-02T09:00:00.000Z")
    expect(after.updatedAt).toBe(before)
  })

  it("marks a schedule completed without touching updatedAt, and drops it from the bus", async () => {
    const store = await makeStore()
    const at = new Date(Date.now() + 3_600_000).toISOString()
    const schedule = store.create("alice", input({ timing: { kind: "once", at } }))
    const before = store.get("alice", schedule.id)!.updatedAt
    expect(store.subscriptions().map((s) => s.id)).toContain(`schedule:${schedule.id}`)

    store.markCompleted("alice", schedule.id, "2026-09-02T09:00:00.000Z")
    const after = store.get("alice", schedule.id)!
    expect(after.completedAt).toBe("2026-09-02T09:00:00.000Z")
    expect(after.updatedAt).toBe(before)
    expect(store.subscriptions().map((s) => s.id)).not.toContain(`schedule:${schedule.id}`)
  })

  /**
   * The plan's bet: a schedule is a subscription, derived from the row rather
   * than stored. This is what makes the derivation true.
   */
  it("derives a subscription that matches its own schedule.fired", async () => {
    const store = await makeStore()
    const schedule = store.create("alice", input())
    const subscription = scheduleSubscription(schedule)

    expect(subscription.id).toBe(`schedule:${schedule.id}`)
    expect(subscription.match).toEqual({
      type: "schedule.fired",
      where: { source: `schedule:${schedule.id}` },
    })
    expect(subscription.agent).toBe("devops")
  })

  it("defaults a schedule to reporting only on request, and lets it be flipped", async () => {
    const store = await makeStore()
    const schedule = store.create("alice", input())
    expect(schedule.reportMode).toBe("on_request")
    expect(scheduleSubscription(schedule).reportMode).toBe("on_request")

    const updated = store.update("alice", schedule.id, { reportMode: "always" })
    expect(updated?.reportMode).toBe("always")
  })

  it("offers only enabled, not-yet-completed schedules to the bus", async () => {
    const store = await makeStore()
    const on = store.create("alice", input({ title: "on" }))
    const off = store.create("alice", input({ title: "off" }))
    store.update("alice", off.id, { enabled: false })

    const ids = store.subscriptions().map((subscription) => subscription.id)
    expect(ids).toContain(`schedule:${on.id}`)
    expect(ids).not.toContain(`schedule:${off.id}`)
  })
})

/**
 * The end-to-end path the milestone is really about: a schedule's clock ticks,
 * the scheduler publishes `schedule.fired`, and the *bus* — not the scheduler —
 * opens the job. No free-standing schedule producer.
 */
describe("a schedule fires through the bus", () => {
  async function wired() {
    const database = await migratedDatabase()
    const schedules = new SchedulesStore(database)
    const jobs = new JobsCoordinator(database)
    jobs.setDispatcher(() => {})
    const bus = new EventBus([() => schedules.subscriptions()], jobs, new ChatStore(database))
    const scheduler = new Scheduler(schedules, bus, () => {})
    return { schedules, jobs, bus, scheduler }
  }

  it("opens a job for the schedule's agent when its timer fires", async () => {
    const { schedules, jobs, bus } = await wired()
    const schedule = schedules.create(
      "alice",
      input({ title: "Nightly digest", instruction: "Produce the digest." }),
    )

    // Simulate the tick the scheduler's timer would cause.
    const { reactions } = bus.publish({
      type: "schedule.fired",
      tenantId: "alice",
      source: `schedule:${schedule.id}`,
      payload: { source: `schedule:${schedule.id}` },
    })

    expect(reactions).toHaveLength(1)
    const job = jobs.get("alice", reactions[0]!.jobId)
    // The job takes the schedule's name, not a slice of the instruction.
    expect(job).toMatchObject({
      assigneeAgent: "devops",
      title: "Nightly digest",
      instruction: "Produce the digest.",
    })
    // A schedule's job is silent by default: it only speaks up if it finds something.
    expect(job?.reportMode).toBe("on_request")
  })

  it("does not fire another schedule's subscription", async () => {
    const { schedules, bus } = await wired()
    schedules.create("alice", input({ title: "A" }))
    const b = schedules.create("alice", input({ title: "B" }))

    const { reactions } = bus.publish({
      type: "schedule.fired",
      tenantId: "alice",
      source: `schedule:${b.id}`,
      payload: { source: `schedule:${b.id}` },
    })
    expect(reactions.map((reaction) => reaction.subscriptionId)).toEqual([`schedule:${b.id}`])
  })
})
