import { describe, expect, it } from "vitest"
import { SchedulesStore } from "../../src/coordinator/schedules-store.ts"
import {
  type ScheduleToolContext,
  listSchedules,
  removeSchedule,
  setSchedule,
} from "../../src/tools/schedule-tools.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function makeStore(): Promise<SchedulesStore> {
  return new SchedulesStore(await migratedDatabase())
}

const alice: ScheduleToolContext = { tenantId: "alice", agent: "devops" }

describe("schedule tools", () => {
  it("creates a schedule, then updates it when set by the same title", async () => {
    const store = await makeStore()

    const created = setSchedule(store, alice, {
      title: "Morning triage",
      instruction: "Review open PRs.",
      cron: "0 9 * * *",
    })
    expect(created).toMatch(/Created schedule "Morning triage"/)
    expect(store.list("alice")).toHaveLength(1)

    const updated = setSchedule(store, alice, { title: "Morning triage", every_seconds: 1800 })
    expect(updated).toMatch(/Updated schedule "Morning triage"/)
    // Same title updates in place — not a second schedule.
    const schedules = store.list("alice")
    expect(schedules).toHaveLength(1)
    expect(schedules[0]?.timing).toEqual({ kind: "interval", seconds: 1800 })
  })

  it("creates a one-off from at and from in_seconds", async () => {
    const store = await makeStore()

    const at = new Date(Date.now() + 3_600_000).toISOString()
    const byAt = setSchedule(store, alice, { title: "At", instruction: "do it", at })
    expect(byAt).toMatch(/Created schedule "At"/)
    expect(store.list("alice").find((s) => s.title === "At")?.timing).toEqual({ kind: "once", at })

    const before = Date.now()
    setSchedule(store, alice, { title: "Soon", instruction: "do it", in_seconds: 10_800 })
    const soon = store.list("alice").find((s) => s.title === "Soon")
    expect(soon?.timing.kind).toBe("once")
    if (soon?.timing.kind === "once") {
      const fireAt = new Date(soon.timing.at).getTime()
      expect(fireAt).toBeGreaterThanOrEqual(before + 10_800_000)
    }
  })

  it("requires an instruction and a timing to create", async () => {
    const store = await makeStore()
    expect(setSchedule(store, alice, { title: "x", cron: "0 9 * * *" })).toMatch(
      /needs an instruction/,
    )
    expect(setSchedule(store, alice, { title: "x", instruction: "do it" })).toMatch(/needs a time/)
    expect(store.list("alice")).toHaveLength(0)
  })

  it("rejects a bad cron, a past one-off, and a two-timing call", async () => {
    const store = await makeStore()
    expect(setSchedule(store, alice, { title: "x", instruction: "y", cron: "not a cron" })).toMatch(
      /not a valid cron/,
    )
    expect(
      setSchedule(store, alice, {
        title: "x",
        instruction: "y",
        at: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toMatch(/in the past/)
    expect(
      setSchedule(store, alice, {
        title: "x",
        instruction: "y",
        cron: "0 9 * * *",
        every_seconds: 60,
      }),
    ).toMatch(/exactly one of/)
    expect(store.list("alice")).toHaveLength(0)
  })

  it("only sees and removes the agent's own schedules", async () => {
    const store = await makeStore()
    // Same tenant, a different agent's schedule.
    store.create("alice", {
      title: "Nightly backup",
      agent: "ops",
      instruction: "back up",
      timing: { kind: "interval", seconds: 3600 },
      catchUp: false,
      deadlineSeconds: null,
    })
    setSchedule(store, alice, { title: "Mine", instruction: "y", every_seconds: 60 })

    expect(listSchedules(store, alice)).toMatch(/Mine/)
    expect(listSchedules(store, alice)).not.toMatch(/Nightly backup/)
    // Removing another agent's schedule by title is a miss, not a cross-agent delete.
    expect(removeSchedule(store, alice, "Nightly backup")).toMatch(/no schedule titled/)
    expect(store.list("alice")).toHaveLength(2)
    expect(removeSchedule(store, alice, "Mine")).toMatch(/Removed schedule "Mine"/)
    expect(store.list("alice")).toHaveLength(1)
  })

  it("lists a friendly message when the agent has none", async () => {
    const store = await makeStore()
    expect(listSchedules(store, alice)).toMatch(/You have no schedules/)
  })
})
