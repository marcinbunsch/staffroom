import { type Schedule, SCHEDULE_FIRED, scheduleSource } from "@staffroom/protocol"
import { Cron } from "croner"
import type { EventBus } from "./event-bus.ts"
import { getEventBus } from "./event-bus.ts"
import type { SchedulesStore } from "./schedules-store.ts"
import { getSchedulesStore } from "./schedules-store.ts"

/**
 * The clock half of a schedule.
 *
 * A schedule is one row from which both a timer and a subscription derive. This
 * owns the timer; the bus owns the reaction. When a timer fires it does not
 * open a job — it **publishes `schedule.fired`**, and the bus matches the
 * schedule's derived subscription and opens the job. That indirection is the
 * point: there are no free-standing schedule producers, so every event in the
 * system flows through one mechanism, and schedules prove it.
 *
 * A schedule runs as a routine (recurring — `cron`/`interval`) or once (`once`,
 * a one-off). A one-off fires a single time and is then marked completed, so it
 * drops out of the derived subscriptions and never fires again.
 *
 * Also owns the deadline sweep interval, because it is the one component that
 * already has a start/reload/dispose lifecycle for timers.
 */
export class Scheduler {
  readonly #schedules: SchedulesStore
  readonly #bus: EventBus
  readonly #onSweep: () => void
  readonly #timers = new Map<string, () => void>()
  #sweepTimer: ReturnType<typeof setInterval> | undefined
  #started = false

  constructor(schedules: SchedulesStore, bus: EventBus, onSweep: () => void) {
    this.#schedules = schedules
    this.#bus = bus
    this.#onSweep = onSweep
  }

  /** Load active schedules, schedule them, and start the deadline sweep. Idempotent. */
  start(sweepEveryMs = 30_000): void {
    if (this.#started) return
    this.#started = true
    this.#scheduleAll()
    this.#sweepTimer = setInterval(this.#onSweep, sweepEveryMs)
    this.#sweepTimer.unref()
    console.log(`[scheduler] started with ${this.#timers.size} schedule(s)`)
  }

  /** Re-read schedules and reschedule. Call after any schedule change. */
  reload(): void {
    if (!this.#started) return
    this.#scheduleAll()
  }

  dispose(): void {
    this.#clearTimers()
    if (this.#sweepTimer) clearInterval(this.#sweepTimer)
    this.#started = false
  }

  #scheduleAll(): void {
    this.#clearTimers()
    for (const schedule of this.#schedules.listAcrossTenants()) {
      if (schedule.enabled && schedule.completedAt === null) this.#schedule(schedule)
    }
  }

  #clearTimers(): void {
    for (const stop of this.#timers.values()) stop()
    this.#timers.clear()
  }

  #schedule(schedule: Schedule): void {
    if (schedule.timing.kind === "cron") {
      const cron = new Cron(
        schedule.timing.expression,
        { catch: (error: unknown) => console.error(`[scheduler] "${schedule.id}" failed:`, error) },
        () => this.#fire(schedule),
      )
      this.#timers.set(schedule.id, () => cron.stop())
      this.#catchUpIfMissed(schedule, cron.previousRun())
    } else if (schedule.timing.kind === "interval") {
      const everyMs = schedule.timing.seconds * 1000
      const timer = setInterval(() => this.#fire(schedule), everyMs)
      timer.unref()
      this.#timers.set(schedule.id, () => clearInterval(timer))
      const previous = schedule.lastFiredAt ? new Date(Date.now() - everyMs) : null
      this.#catchUpIfMissed(schedule, previous)
    } else {
      this.#scheduleOnce(schedule, schedule.timing.at)
    }
  }

  /**
   * A one-off. If its time is still ahead, arm a single-shot timer. If it has
   * already passed (the process was down through it), it can never fire on the
   * clock again, so handle it like a missed run — fire once if `catchUp`, else
   * skip loudly — and either way `#fire` marks it completed so it leaves the
   * subscriptions.
   */
  #scheduleOnce(schedule: Schedule, at: string): void {
    const when = new Date(at)
    if (when.getTime() > Date.now()) {
      const cron = new Cron(
        when,
        {
          maxRuns: 1,
          catch: (error: unknown) => console.error(`[scheduler] "${schedule.id}" failed:`, error),
        },
        () => this.#fire(schedule),
      )
      this.#timers.set(schedule.id, () => cron.stop())
      return
    }
    if (schedule.catchUp) {
      console.log(`[scheduler] "${schedule.id}" one-off time passed while down — catching up`)
      this.#fire(schedule)
    } else {
      console.log(
        `[scheduler] "${schedule.id}" one-off time passed while down — skipping (catchUp off)`,
      )
      this.#schedules.markCompleted(schedule.tenantId, schedule.id, new Date().toISOString())
    }
  }

  /**
   * A run was missed while the process was down if the previous scheduled time
   * is after the last fire. Default is to skip it (loudly); `catchUp` fires once
   * now. This is a cursor comparison, exactly as the plan intends.
   */
  #catchUpIfMissed(schedule: Schedule, previousScheduled: Date | null): void {
    if (!schedule.lastFiredAt || !previousScheduled) return
    const missed = previousScheduled.getTime() > new Date(schedule.lastFiredAt).getTime()
    if (!missed) return
    if (schedule.catchUp) {
      console.log(`[scheduler] "${schedule.id}" catching up a missed run`)
      this.#fire(schedule)
    } else {
      console.log(`[scheduler] "${schedule.id}" missed a run while down — skipping (catchUp off)`)
    }
  }

  #fire(schedule: Schedule): void {
    try {
      const source = scheduleSource(schedule.id)
      this.#bus.publish({
        type: SCHEDULE_FIRED,
        tenantId: schedule.tenantId,
        source,
        payload: { source, scheduleId: schedule.id, title: schedule.title },
      })
      const now = new Date().toISOString()
      // A one-off is done the moment it fires: mark it completed so it drops out
      // of the subscriptions and never fires again. Recurring schedules just
      // advance the cursor.
      if (schedule.timing.kind === "once") {
        this.#schedules.markCompleted(schedule.tenantId, schedule.id, now)
      } else {
        this.#schedules.markFired(schedule.tenantId, schedule.id, now)
      }
    } catch (error) {
      // A bad schedule must not kill the timer for everything else.
      console.error(`[scheduler] schedule "${schedule.id}" could not fire:`, error)
    }
  }
}

let scheduler: Scheduler | undefined

export function getScheduler(onSweep: () => void): Scheduler {
  if (!scheduler) scheduler = new Scheduler(getSchedulesStore(), getEventBus(), onSweep)
  return scheduler
}
