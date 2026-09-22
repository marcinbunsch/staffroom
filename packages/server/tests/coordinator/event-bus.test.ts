import type { EventEnvelope, Subscription } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"
import { EventBus, matches } from "../../src/coordinator/event-bus.ts"
import { ChatStore } from "../../src/coordinator/chats.ts"
import { JobsCoordinator } from "../../src/coordinator/jobs.ts"
import { migratedDatabase } from "../migrated-database.ts"

function envelope(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    id: "evt-1",
    type: "schedule.fired",
    tenantId: "alice",
    scope: "tenant",
    source: "schedule:daily",
    payload: { source: "schedule:daily" },
    chain: [],
    depth: 0,
    at: "2026-09-02T00:00:00.000Z",
    ...overrides,
  }
}

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "schedule:daily",
    tenantId: "alice",
    match: { type: "schedule.fired", where: { source: "schedule:daily" } },
    agent: "devops",
    title: "Daily digest",
    instruction: "Produce the daily digest.",
    cursor: null,
    enabled: true,
    deadlineSeconds: null,
    reportMode: "always",
    ...overrides,
  }
}

describe("the matcher", () => {
  it("requires the type to match", () => {
    expect(matches(envelope({ type: "file.created" }), { type: "schedule.fired" })).toBe(false)
  })

  it("matches on type alone when there is no where clause", () => {
    expect(matches(envelope(), { type: "schedule.fired" })).toBe(true)
  })

  it("matches a top-level field like source", () => {
    expect(
      matches(envelope(), { type: "schedule.fired", where: { source: "schedule:daily" } }),
    ).toBe(true)
    expect(
      matches(envelope(), { type: "schedule.fired", where: { source: "schedule:other" } }),
    ).toBe(false)
  })

  it("matches a payload field like visibility", () => {
    const file = envelope({ type: "file.created", payload: { visibility: "org" } })
    expect(matches(file, { type: "file.created", where: { visibility: "org" } })).toBe(true)
    expect(matches(file, { type: "file.created", where: { visibility: "private" } })).toBe(false)
  })

  it("matches an array payload field by membership", () => {
    const file = envelope({ type: "file.created", payload: { labels: ["invoices", "2025"] } })
    expect(matches(file, { type: "file.created", where: { labels: "invoices" } })).toBe(true)
    expect(matches(file, { type: "file.created", where: { labels: "receipts" } })).toBe(false)
  })

  it("requires every where key to match", () => {
    const file = envelope({ type: "file.created", payload: { visibility: "org", kind: "report" } })
    expect(matches(file, { type: "file.created", where: { visibility: "org", kind: "log" } })).toBe(
      false,
    )
  })
})

async function makeBus(subscriptions: Subscription[]) {
  const database = await migratedDatabase()
  const jobs = new JobsCoordinator(database)
  jobs.setDispatcher(() => {})
  const bus = new EventBus([() => subscriptions], jobs, new ChatStore(database))
  return { bus, jobs }
}

describe("the event bus", () => {
  it("opens a job for a matching subscription", async () => {
    const { bus, jobs } = await makeBus([subscription()])
    const { reactions } = bus.publish(envelope())

    expect(reactions).toHaveLength(1)
    const job = jobs.get("alice", reactions[0]!.jobId)
    expect(job).toMatchObject({ assigneeAgent: "devops", instruction: "Produce the daily digest." })
  })

  it("ignores a subscription that does not match", async () => {
    const { bus } = await makeBus([subscription({ match: { type: "file.created" } })])
    expect(bus.publish(envelope()).reactions).toHaveLength(0)
  })

  it("ignores a disabled subscription", async () => {
    const { bus } = await makeBus([subscription({ enabled: false })])
    expect(bus.publish(envelope()).reactions).toHaveLength(0)
  })

  describe("scope", () => {
    it("does not fire on another tenant's event", async () => {
      const { bus } = await makeBus([subscription({ tenantId: "bob" })])
      expect(bus.publish(envelope({ tenantId: "alice" })).reactions).toHaveLength(0)
    })

    it("lets any tenant's subscription see an org-scoped event", async () => {
      const { bus } = await makeBus([
        subscription({ tenantId: "bob", match: { type: "file.created" } }),
      ])
      const orgEvent = envelope({
        type: "file.created",
        scope: "org",
        tenantId: "alice",
        payload: {},
      })
      expect(bus.publish(orgEvent).reactions).toHaveLength(1)
    })
  })

  describe("loop protection", () => {
    /** The cycle guard: a subscription already in the chain would loop. */
    it("refuses a subscription that is already in the event's chain", async () => {
      const { bus } = await makeBus([subscription()])
      expect(bus.publish(envelope({ chain: ["schedule:daily"] })).reactions).toHaveLength(0)
    })

    it("fires a subscription that is not in the chain", async () => {
      const { bus } = await makeBus([subscription()])
      expect(bus.publish(envelope({ chain: ["schedule:other"] })).reactions).toHaveLength(1)
    })

    /** The depth cap: runaway fan-out that never repeats a subscription. */
    it("drops an event past the depth cap", async () => {
      const { bus } = await makeBus([subscription()])
      expect(bus.publish(envelope({ depth: 6 })).reactions).toHaveLength(0)
    })

    it("fires at the depth cap boundary", async () => {
      const { bus } = await makeBus([subscription()])
      expect(bus.publish(envelope({ depth: 5 })).reactions).toHaveLength(1)
    })
  })

  it("opens the job with the subscription's deadline", async () => {
    const { bus, jobs } = await makeBus([subscription({ deadlineSeconds: 3600 })])
    const { reactions } = bus.publish(envelope())
    expect(jobs.get("alice", reactions[0]!.jobId)?.deadlineAt).not.toBeNull()
  })
})
