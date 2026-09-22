import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { deliverToSession } from "../coordinator/agent-messaging.ts"
import { getAttentionStore } from "../coordinator/attention.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * The operator's attention board and the confirm-gate answers.
 *
 * Answering an approval is the resume half of the suspend-and-resume gate: the
 * store flips the approval, and this dispatches a *new turn* into the session
 * that raised it. The agent re-renders, sees its own earlier attempt, re-issues
 * the call, and this time the one-shot approval lets it through.
 *
 * Mounted at `/api/attention`, so the paths here are relative — that keeps the
 * type (`AttentionRoutes`) clean for the Hono RPC client. The handlers are
 * chained (RPC infers the client from the chain) and validated with
 * `zValidator` (the input types the client sees).
 */
const idParam = z.object({ id: z.string() })

export const attentionRoutes = new Hono<SessionEnv>()
  .get("/", (context) => {
    const { tenantId } = context.get("caller")
    return context.json({ items: getAttentionStore().open(tenantId) })
  })
  .post(
    "/approvals/:id",
    zValidator("param", idParam),
    zValidator(
      "json",
      z.object({ decision: z.enum(["approved", "denied"]), reason: z.string().optional() }),
    ),
    async (context) => {
      const { tenantId } = context.get("caller")
      const { id } = context.req.valid("param")
      const { decision, reason } = context.req.valid("json")

      const approval = getAttentionStore().answer(tenantId, id, decision, reason)
      if (!approval) return context.json({ error: "unknown_or_answered" }, 404)

      // Resume the session with a new turn. Delivered as a "user" message, not a
      // signal: a signal is wrapped as a job cue and neither renders in the chat
      // nor reliably wakes a plain chat session — the answer has to arrive as a
      // turn the agent responds to. The model then sees its own earlier attempt
      // and re-issues the call.
      const message =
        approval.state === "approved"
          ? `Your request to run ${approval.tool} was approved — proceed with the same call.`
          : `Your request to run ${approval.tool} was denied${approval.reason ? `: ${approval.reason}` : ""}. Do not retry it; adapt or stop.`
      deliverToSession(approval.session, message, "user")

      return context.json({ approval })
    },
  )
  /**
   * Resolve an agent-raised request (the `attention_request` escalation) —
   * answer it. Same resume-with-a-new-turn as an approval; the operator's note,
   * if any, carries into the session verbatim. A blank note is fine: the agent
   * is told to carry on (the operator may have answered in the chat instead).
   */
  .post(
    "/items/:id/resolve",
    zValidator("param", idParam),
    zValidator("json", z.object({ note: z.string().optional() })),
    async (context) => {
      const { tenantId } = context.get("caller")
      const { id } = context.req.valid("param")
      const note = context.req.valid("json").note?.trim()

      const item = getAttentionStore().resolveRequest(tenantId, id)
      if (!item) return context.json({ error: "unknown_or_answered" }, 404)

      const answer = note
        ? `The operator answered your request "${item.title}":\n\n${note}\n\nContinue with this.`
        : `The operator resolved your request "${item.title}". Continue.`
      // "user", not "signal": the answer must render in the chat and wake the
      // agent as a turn — a signal is a job cue that does neither in a plain chat
      // session.
      deliverToSession(item.session, answer, "user")

      return context.json({ item })
    },
  )
  /**
   * Dismiss an agent-raised request — stand the agent down. A reason is
   * required, because being told why is what lets the agent adapt rather than
   * just retry.
   */
  .post(
    "/items/:id/dismiss",
    zValidator("param", idParam),
    zValidator("json", z.object({ note: z.string().optional() })),
    async (context) => {
      const { tenantId } = context.get("caller")
      const { id } = context.req.valid("param")
      const note = context.req.valid("json").note?.trim()
      if (!note) return context.json({ error: "note_required" }, 400)

      const item = getAttentionStore().dismissRequest(tenantId, id)
      if (!item) return context.json({ error: "unknown_or_answered" }, 404)

      deliverToSession(
        item.session,
        `The operator dismissed your request "${item.title}": ${note}. Do not retry it; adapt or stop.`,
        "user",
      )

      return context.json({ item })
    },
  )

/** The router's type, for the Hono RPC client (`hc<AttentionRoutes>`). */
export type AttentionRoutes = typeof attentionRoutes
