import { StaffMemberInput, StaffMemberUpdate, composeSessionKey } from "@staffroom/protocol"
import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { getActivityTracker } from "../coordinator/activity.ts"
import { getAttentionStore } from "../coordinator/attention.ts"
import { getJobsCoordinator } from "../coordinator/jobs.ts"
import { agentOverview } from "../coordinator/presence.ts"
import { StaffExistsError, getRosterStore } from "../coordinator/roster.ts"
import { getUnreadStore } from "../coordinator/unread.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Staff members (agents) — the roster, its live overview, and edits. Mounted at
 * `/api/staff`, so paths are relative. Every handler reads its tenant from the
 * authenticated caller, never a path/body, so no request can address another
 * tenant's roster.
 */
export const staffRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    const roster = getRosterStore()
      .list(tenantId)
      .map((member) => ({
        ...member,
        session: composeSessionKey({ tenantId, agentId: member.id }),
      }))
    return context.json({ staff: roster })
  })
  // The rail's live view: one overview per agent (activity, label, unread, open
  // attention), resolved server-side. (Was `/api/agents/overview`.)
  .get("/overview", (context) => {
    const { tenantId } = context.get("caller")
    return context.json(
      agentOverview(
        tenantId,
        getRosterStore().list(tenantId),
        getJobsCoordinator().list(tenantId),
        getActivityTracker(),
        getUnreadStore().counts(tenantId),
        getAttentionStore().open(tenantId),
      ),
    )
  })
  .post("/", zValidator("json", StaffMemberInput), (context) => {
    const { tenantId } = context.get("caller")
    try {
      return context.json(
        { member: getRosterStore().create(tenantId, context.req.valid("json")) },
        201,
      )
    } catch (error) {
      if (error instanceof StaffExistsError) {
        return context.json({ error: "staff_exists", id: error.id }, 409)
      }
      throw error
    }
  })
  .patch(
    "/:id",
    zValidator("param", z.object({ id: z.string() })),
    zValidator("json", StaffMemberUpdate),
    (context) => {
      const { tenantId } = context.get("caller")
      const member = getRosterStore().update(
        tenantId,
        context.req.valid("param").id,
        context.req.valid("json"),
      )
      if (!member) return context.json({ error: "unknown_agent" }, 404)
      return context.json({ member })
    },
  )
  .delete("/:id", zValidator("param", z.object({ id: z.string() })), (context) => {
    const { tenantId } = context.get("caller")
    const removed = getRosterStore().remove(tenantId, context.req.valid("param").id)
    if (!removed) return context.json({ error: "unknown_agent" }, 404)
    return context.json({ removed: true })
  })

export type StaffRoutes = typeof staffRoutes
