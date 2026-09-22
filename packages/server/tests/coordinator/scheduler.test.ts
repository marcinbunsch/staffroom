import type { ScheduleInput } from "@staffroom/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EventBus } from "../../src/coordinator/event-bus.ts"
import { ChatStore } from "../../src/coordinator/chats.ts"
import { JobsCoordinator } from "../../src/coordinator/jobs.ts"
import { SchedulesStore } from "../../src/coordinator/schedules-store.ts"
import { Scheduler } from "../../src/coordinator/scheduler.ts"
import { migratedDatabase } from "../migrated-database.ts"

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    title: "Every minute",
    agent: "devops",
    instruction: "Do the thing.",
    timing: { kind: "interval", seconds: 60 },
    ...overrides,
  }
}

async function wired() {
  const database = await migratedDatabase()
  const schedules = new SchedulesStore(database)
  const jobs = new JobsCoordinator(database)
  jobs.setDispatcher(() => {})
  const bus = new EventBus([() => schedules.subscriptions()], jobs, new ChatStore(database))
  const scheduler = new Scheduler(schedules, bus, () => {})
  return { schedules, jobs, scheduler }
}

describe("catch-up on start", () => {
  const schedulers: Scheduler[] = []

  afterEach(() => {
    for (const scheduler of schedulers.splice(0)) scheduler.dispose()
    vi.useRealTimers()
  })

  /**
   * A run was missed while the process was down if a scheduled time falls
   * between the last fire and now. `catchUp` fires it once on start.
   */
  it("fires a missed interval run once when catchUp is on", async () => {
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    const schedule = schedules.create("alice", input({ catchUp: true }))
    // It last fired two minutes ago; a 60s interval means a run was missed.
    schedules.markFired("alice", schedule.id, new Date(Date.now() - 120_000).toISOString())

    scheduler.start()

    expect(jobs.list("alice")).toHaveLength(1)
  })

  it("skips a missed run when catchUp is off", async () => {
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    const schedule = schedules.create("alice", input({ catchUp: false }))
    schedules.markFired("alice", schedule.id, new Date(Date.now() - 120_000).toISOString())

    scheduler.start()

    expect(jobs.list("alice")).toHaveLength(0)
  })

  it("does not catch up a schedule that has never fired", async () => {
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    schedules.create("alice", input({ catchUp: true }))

    scheduler.start()

    expect(jobs.list("alice")).toHaveLength(0)
  })

  it("fires the schedule when its interval elapses", async () => {
    vi.useFakeTimers()
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    schedules.create("alice", input({ timing: { kind: "interval", seconds: 1 } }))

    scheduler.start()
    expect(jobs.list("alice")).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(jobs.list("alice")).toHaveLength(1)
  })
})

describe("one-off schedules", () => {
  const schedulers: Scheduler[] = []

  afterEach(() => {
    for (const scheduler of schedulers.splice(0)) scheduler.dispose()
    vi.useRealTimers()
  })

  it("fires a one-off when its time arrives, then marks it completed", async () => {
    vi.useFakeTimers()
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    const at = new Date(Date.now() + 1000).toISOString()
    const schedule = schedules.create("alice", input({ timing: { kind: "once", at } }))

    scheduler.start()
    expect(jobs.list("alice")).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)

    expect(jobs.list("alice")).toHaveLength(1)
    expect(schedules.get("alice", schedule.id)?.completedAt).not.toBeNull()
    // Completed: it has left the bus and cannot fire again.
    expect(schedules.subscriptions()).toHaveLength(0)
  })

  it("catches up a one-off whose time passed while down, then completes it", async () => {
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    const at = new Date(Date.now() - 60_000).toISOString()
    const schedule = schedules.create(
      "alice",
      input({ timing: { kind: "once", at }, catchUp: true }),
    )

    scheduler.start()

    expect(jobs.list("alice")).toHaveLength(1)
    expect(schedules.get("alice", schedule.id)?.completedAt).not.toBeNull()
  })

  it("skips a past one-off when catchUp is off, but still completes it", async () => {
    const { schedules, jobs, scheduler } = await wired()
    schedulers.push(scheduler)
    const at = new Date(Date.now() - 60_000).toISOString()
    const schedule = schedules.create(
      "alice",
      input({ timing: { kind: "once", at }, catchUp: false }),
    )

    scheduler.start()

    expect(jobs.list("alice")).toHaveLength(0)
    // A past one-off can never fire on the clock again, so it is marked done.
    expect(schedules.get("alice", schedule.id)?.completedAt).not.toBeNull()
  })
})
