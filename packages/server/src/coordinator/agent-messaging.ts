/**
 * The one seam by which coordinator code reaches an agent session, without
 * importing the agent.
 *
 * `app.ts` is the only module that imports everything, so it is the only place
 * that can hand out a dispatcher. The jobs coordinator gets one via
 * `setDispatcher`; anything else that needs to deliver into a session (an
 * operator's answer to an attention request, later) uses this.
 *
 * Kept a module-level function rather than a parameter because the callers are
 * deep in the coordinator and threading it through every one would be noise.
 */

export type SessionDeliver = (session: string, body: string, kind: "signal" | "user") => void

let deliver: SessionDeliver | undefined

export function setSessionDeliver(fn: SessionDeliver): void {
  deliver = fn
}

export function deliverToSession(session: string, body: string, kind: "signal" | "user"): void {
  if (!deliver) throw new Error("[messaging] session deliver not configured")
  deliver(session, body, kind)
}
