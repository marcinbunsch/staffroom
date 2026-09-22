import { randomUUID } from "node:crypto"
import {
  Schedule,
  type ScheduleInput,
  type ScheduleUpdate,
  Timing,
  type Subscription,
  scheduleSource,
  SCHEDULE_FIRED,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import { getOperatorEvents } from "./operator-events.ts"
import type { ScheduleTable } from "./schema.ts"

/**
 * Schedule definitions.
 *
 * The store also answers the question the bus asks — "what subscriptions
 * exist?" — because for a schedule the subscription is *derived* from the row,
 * not stored separately. That derivation lives here, next to the data it reads,
 * so there is one place that knows a schedule is also a subscription.
 */
export class SchedulesStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Ring the operator bus — the schedules list changed for this tenant. */
  #announce(tenantId: string): void {
    getOperatorEvents().publish({ tenantId, event: { type: "schedule.changed" } })
  }

  list(tenantId: string): Schedule[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("schedules")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .orderBy("created_at", "asc"),
      )
      .map(rowToSchedule)
  }

  /** Every schedule across tenants — the scheduler builds a timer for each at boot. */
  listAcrossTenants(): Schedule[] {
    return this.#db
      .all(this.#db.qb.selectFrom("schedules").selectAll().orderBy("created_at", "asc"))
      .map(rowToSchedule)
  }

  get(tenantId: string, id: string): Schedule | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("schedules")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    return row ? rowToSchedule(row) : undefined
  }

  create(tenantId: string, input: ScheduleInput): Schedule {
    const id = randomUUID()
    const now = new Date().toISOString()
    const parsed = Timing.parse(input.timing)
    this.#db.run(
      this.#db.qb.insertInto("schedules").values({
        id,
        tenant_id: tenantId,
        title: input.title,
        agent: input.agent,
        instruction: input.instruction,
        timing: JSON.stringify(parsed),
        catch_up: input.catchUp ? 1 : 0,
        enabled: 1,
        deadline_seconds: input.deadlineSeconds ?? null,
        report_mode: input.reportMode ?? "on_request",
        last_fired_at: null,
        completed_at: null,
        created_at: now,
        updated_at: now,
      }),
    )
    const created = this.get(tenantId, id)
    if (!created) throw new Error(`schedule "${id}" did not persist`)
    this.#announce(tenantId)
    return created
  }

  update(tenantId: string, id: string, input: ScheduleUpdate): Schedule | undefined {
    const existing = this.get(tenantId, id)
    if (!existing) return undefined
    const merged = { ...existing, ...input }
    this.#db.run(
      this.#db.qb
        .updateTable("schedules")
        .set({
          title: merged.title,
          agent: merged.agent,
          instruction: merged.instruction,
          timing: JSON.stringify(merged.timing),
          catch_up: merged.catchUp ? 1 : 0,
          enabled: merged.enabled ? 1 : 0,
          deadline_seconds: merged.deadlineSeconds,
          report_mode: merged.reportMode,
          updated_at: new Date().toISOString(),
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#announce(tenantId)
    return this.get(tenantId, id)
  }

  remove(tenantId: string, id: string): boolean {
    const removed =
      this.#db.run(
        this.#db.qb.deleteFrom("schedules").where("tenant_id", "=", tenantId).where("id", "=", id),
      ).changes > 0
    if (removed) this.#announce(tenantId)
    return removed
  }

  /** Advance the cursor after a fire. Deliberately does not touch `updated_at`. */
  markFired(tenantId: string, id: string, firedAt: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("schedules")
        .set({ last_fired_at: firedAt })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#announce(tenantId)
  }

  /**
   * Mark a one-off done after it fired (or after its time passed while down). A
   * completed schedule is kept as a record but drops out of `subscriptions()`,
   * so it never fires again. Like `markFired`, this is not an edit — it leaves
   * `updated_at` alone.
   */
  markCompleted(tenantId: string, id: string, completedAt: string): void {
    this.#db.run(
      this.#db.qb
        .updateTable("schedules")
        .set({ completed_at: completedAt })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id),
    )
    this.#announce(tenantId)
  }

  /**
   * The subscriptions the bus should consider — one per enabled, not-yet-
   * completed schedule, derived, never stored. A schedule matches its own
   * `schedule.fired` event and reacts by opening a job for its agent with its
   * instruction. A completed one-off is gone from the bus.
   */
  subscriptions(): Subscription[] {
    return this.listAcrossTenants()
      .filter((schedule) => schedule.enabled && schedule.completedAt === null)
      .map(scheduleSubscription)
  }
}

/** The derived subscription for one schedule. Exported so the scheduler agrees on the id. */
export function scheduleSubscription(schedule: Schedule): Subscription {
  return {
    id: scheduleSource(schedule.id),
    tenantId: schedule.tenantId,
    match: { type: SCHEDULE_FIRED, where: { source: scheduleSource(schedule.id) } },
    agent: schedule.agent,
    title: schedule.title,
    instruction: schedule.instruction,
    cursor: schedule.lastFiredAt,
    enabled: schedule.enabled,
    deadlineSeconds: schedule.deadlineSeconds,
    reportMode: schedule.reportMode,
  }
}

function rowToSchedule(row: ScheduleTable): Schedule {
  return Schedule.parse({
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    agent: row.agent,
    instruction: row.instruction,
    timing: typeof row.timing === "string" ? JSON.parse(row.timing) : row.timing,
    catchUp: row.catch_up === 1,
    enabled: row.enabled === 1,
    deadlineSeconds: row.deadline_seconds ?? null,
    reportMode: row.report_mode,
    lastFiredAt: row.last_fired_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

let store: SchedulesStore | undefined

export function getSchedulesStore(): SchedulesStore {
  if (!store) store = new SchedulesStore(getDatabase())
  return store
}
