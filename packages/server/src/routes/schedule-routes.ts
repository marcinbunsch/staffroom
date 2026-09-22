import { zValidator } from "@hono/zod-validator"
import { ScheduleInput, ScheduleUpdate } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { getRosterStore } from "../coordinator/roster.ts"
import { getSchedulesStore } from "../coordinator/schedules-store.ts"
import { getScheduler } from "../coordinator/scheduler.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Schedules: create, edit, enable/disable, delete — all tenant-scoped to the
 * caller. Every change reloads the scheduler, so a new or edited schedule takes
 * effect without a restart.
 *
 * Mounted at `/api/schedules`, so the paths here are relative — that keeps the
 * type (`ScheduleRoutes`) clean for the Hono RPC client. The handlers are chained
 * (RPC infers the client from the chain) and validated with `zValidator`; the
 * validators reuse the protocol schemas and preserve the manual error shapes.
 */
const idParam = z.object({ id: z.string() })

// The scheduler is created with the sweep callback in app.ts; here we only need
// to nudge it to re-read. A no-op sweep is fine — reload never sweeps.
function reloadScheduler(): void {
  getScheduler(() => {}).reload()
}

export const scheduleRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ schedules: getSchedulesStore().list(tenantId) })
  })
  .post(
    "/",
    zValidator("json", ScheduleInput, (result, context) => {
      if (!result.success)
        return context.json({ error: "invalid_schedule", issues: result.error.issues }, 400)
    }),
    (context) => {
      const { tenantId } = context.get("caller")
      const data = context.req.valid("json")
      if (!getRosterStore().get(tenantId, data.agent)) {
        return context.json({ error: "unknown_agent", id: data.agent }, 400)
      }
      const schedule = getSchedulesStore().create(tenantId, data)
      reloadScheduler()
      return context.json({ schedule }, 201)
    },
  )
  .patch(
    "/:id",
    zValidator("param", idParam),
    zValidator("json", ScheduleUpdate, (result, context) => {
      if (!result.success)
        return context.json({ error: "invalid_update", issues: result.error.issues }, 400)
    }),
    (context) => {
      const { tenantId } = context.get("caller")
      const data = context.req.valid("json")
      if (data.agent && !getRosterStore().get(tenantId, data.agent)) {
        return context.json({ error: "unknown_agent", id: data.agent }, 400)
      }
      const schedule = getSchedulesStore().update(tenantId, context.req.valid("param").id, data)
      if (!schedule) return context.json({ error: "unknown_schedule" }, 404)
      reloadScheduler()
      return context.json({ schedule })
    },
  )
  .delete("/:id", zValidator("param", idParam), (context) => {
    const { tenantId } = context.get("caller")
    if (!getSchedulesStore().remove(tenantId, context.req.valid("param").id)) {
      return context.json({ error: "unknown_schedule" }, 404)
    }
    reloadScheduler()
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<ScheduleRoutes>`). */
export type ScheduleRoutes = typeof scheduleRoutes
