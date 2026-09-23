import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { getJobsCoordinator } from "../coordinator/jobs.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * The operator's view of jobs. Read and steer; agents open and close them.
 * Every handler reads its tenant from the caller, never from the path, so no
 * request can reach another tenant's board.
 *
 * Mounted at `/api/jobs`, so the paths here are relative — that keeps the type
 * (`JobRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator`.
 */
export const jobRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ jobs: getJobsCoordinator().list(tenantId) })
  })
  .get("/:id", zValidator("param", z.object({ id: z.string() })), (context) => {
    const { tenantId } = context.get("caller")
    const id = Number(context.req.valid("param").id)
    const detail = Number.isInteger(id) ? getJobsCoordinator().detail(tenantId, id) : undefined
    if (!detail) return context.json({ error: "unknown_job" }, 404)
    return context.json({ job: detail })
  })
  // Operator controls. Each is a small state transition the coordinator owns; the
  // route just names the actor and reports the failure.
  .post(
    "/:id/:action",
    zValidator("param", z.object({ id: z.string(), action: z.string() })),
    zValidator("json", z.object({ message: z.string().optional() })),
    async (context) => {
      const { tenantId } = context.get("caller")
      const { id: idParam, action } = context.req.valid("param")
      const id = Number(idParam)
      if (!Number.isInteger(id)) return context.json({ error: "bad_job_id" }, 400)
      const actor = { kind: "operator" } as const
      const jobs = getJobsCoordinator()
      const body = context.req.valid("json")

      try {
        switch (action) {
          case "pause":
            return context.json({ job: jobs.pause(tenantId, id, actor) })
          case "resume":
            return context.json({ job: jobs.resume(tenantId, id, actor) })
          case "restart":
            return context.json({ job: jobs.restart(tenantId, id, actor) })
          case "stop":
            return context.json({ job: await jobs.stop(tenantId, id, actor) })
          case "cancel":
            return context.json({ job: jobs.cancel(tenantId, id, actor) })
          case "steer": {
            if (!body.message) return context.json({ error: "message_required" }, 400)
            return context.json({ job: jobs.steer(tenantId, id, actor, body.message) })
          }
          default:
            return context.json({ error: "unknown_action", action }, 400)
        }
      } catch (error) {
        return context.json({ error: "job_error", message: reason(error) }, 409)
      }
    },
  )

/** The router's type, for the Hono RPC client (`hc<JobRoutes>`). */
export type JobRoutes = typeof jobRoutes

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
