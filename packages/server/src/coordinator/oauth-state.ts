import { randomBytes } from "node:crypto"

/**
 * Short-lived OAuth `state` values, bound to the user who started the flow.
 *
 * The connect endpoint (session-gated) mints a state and remembers who it is
 * for; the callback is public — Google's redirect is a top-level navigation that
 * cannot be relied on to carry our session cookie — so the state is what proves
 * both identity and that this callback answers a flow we started (CSRF). It is
 * one-shot and expires, so a stolen or replayed state is useless.
 */
interface PendingFlow {
  userId: string
  /** The browser origin, so the callback rebuilds the exact registered redirect URI. */
  origin: string
  expiresAt: number
}

const TTL_MS = 10 * 60_000
const flows = new Map<string, PendingFlow>()

export function putOAuthState(userId: string, origin: string): string {
  sweep()
  const state = randomBytes(24).toString("base64url")
  flows.set(state, { userId, origin, expiresAt: Date.now() + TTL_MS })
  return state
}

/** Consume a state (one-shot). Returns the flow, or undefined if unknown/expired. */
export function takeOAuthState(state: string): { userId: string; origin: string } | undefined {
  const flow = flows.get(state)
  flows.delete(state)
  if (!flow || flow.expiresAt < Date.now()) return undefined
  return { userId: flow.userId, origin: flow.origin }
}

function sweep(): void {
  const now = Date.now()
  for (const [state, flow] of flows) if (flow.expiresAt < now) flows.delete(state)
}
