import { parseSessionKey, sessionTenantId } from "@staffroom/protocol"
import type { MiddlewareHandler } from "hono"

/**
 * Who is asking, and whose session they named — the two questions that are not
 * the same question.
 *
 * Flue's `createAgentRouter` takes the instance id straight from the URL, so
 * `/agents/<someone-else>:devops` is a string the *client* composes. A bearer
 * or cookie check answers only the first question. Without the second, an
 * authenticated user can address any tenant's session by typing it, and
 * because the session key is also where the tenant comes from, everything
 * downstream would then agree with them.
 *
 * So the guard runs before Flue admits the conversation: resolve the session,
 * parse the tenant out of the path, and refuse a mismatch. Flue discards caller
 * headers after admission, which is why this cannot be done any later.
 */

/** The authenticated caller. Kept minimal — this is all the pipeline needs. */
export interface Caller {
  tenantId: string
  role: string
}

export type SessionResolver = (headers: Headers) => Promise<Caller | undefined>

export interface SessionEnv {
  Variables: { caller: Caller }
}

/** 401 unless the request carries a valid session. Stashes the caller for later handlers. */
export function requireSession(resolve: SessionResolver): MiddlewareHandler<SessionEnv> {
  return async (context, next) => {
    const caller = await resolve(context.req.raw.headers)
    if (!caller) return context.json({ error: "unauthorized" }, 401)
    context.set("caller", caller)
    await next()
  }
}

/**
 * 403 unless the session key in the path belongs to the caller.
 *
 * Mounted on `/agents/:id`, where `:id` *is* the Flue session key. Runs after
 * {@link requireSession}, so a caller is always present.
 */
export function rejectForeignSession(): MiddlewareHandler<SessionEnv> {
  return async (context, next) => {
    const sessionKey = context.req.param("id") ?? ""
    const owner = sessionTenantId(sessionKey)

    // A key we cannot parse is refused rather than passed through. An
    // unparseable key has no owner, and "no owner" must never read as "mine".
    if (!owner) return context.json({ error: "bad_session_key", session: sessionKey }, 400)
    if (owner !== context.get("caller").tenantId) {
      return context.json({ error: "forbidden" }, 403)
    }
    await next()
  }
}

/**
 * 404 for an agent the caller's roster does not contain. Runs after
 * {@link rejectForeignSession}, so the key is known to parse and to be theirs —
 * which is why a missing agent here is honestly a 404 and not a 403.
 */
export function rejectUnknownAgent(
  hasAgent: (tenantId: string, agentId: string) => boolean,
): MiddlewareHandler<SessionEnv> {
  return async (context, next) => {
    const identity = parseSessionKey(context.req.param("id") ?? "")
    if (!identity) return context.json({ error: "bad_session_key" }, 400)
    if (!hasAgent(identity.tenantId, identity.agentId)) {
      return context.json({ error: "unknown_agent", id: identity.agentId }, 404)
    }
    await next()
  }
}
