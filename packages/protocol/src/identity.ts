import { z } from "zod"

/**
 * Who an agent turn belongs to, and how that survives a restart.
 *
 * Flue claims submissions from a poll loop, so a job resumed hours later runs
 * with no request, no headers and no ambient context — an `AsyncLocalStorage`
 * tenant would be empty exactly where it matters most. So the tenant travels
 * where Flue already carries something durable: **the session key itself**.
 *
 *   `<tenant>:<agent>`             a member's first main chat
 *   `<tenant>:<agent>__c<id>`      a later main chat (after a start-over)
 *   `<tenant>:<agent>__t<id>`      a side chat
 *   `<tenant>:<agent>__job-<id>`   that member working one job
 *   `<tenant>:<agent>__a2-<other>` an agent-to-agent thread
 *
 * Parse order is tenant, then agent, then suffix — split on the first `:`, then
 * on the first `__` in what remains. That makes `:` the only character a tenant
 * id may not contain, and `_` the only one an agent id may not.
 */

/**
 * A tenant is a better-auth user id. We do not generate these, so the schema
 * describes what we can *rely* on rather than what we would have chosen: any
 * non-empty run of characters that leaves the session key parseable. `:` is
 * excluded because it is the separator; `__` is fine, because the tenant is
 * taken off the front before anything looks for one.
 */
export const TenantId = z
  .string()
  .min(1)
  .regex(/^[^:]+$/, "a tenant id may not contain ':'")

/**
 * An agent id is ours to choose, so it is kept narrow: lowercase, digits and
 * hyphens. No underscore, which is what keeps `__` unambiguous as the job
 * separator no matter what an agent is called.
 */
export const AgentId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an agent id is lowercase letters, digits and hyphens")

export type TenantId = z.infer<typeof TenantId>
export type AgentId = z.infer<typeof AgentId>

/** Everything a session key encodes, once parsed. */
export interface SessionIdentity {
  tenantId: string
  agentId: string
  /** The job this session is working, or undefined for a main chat. */
  jobId?: number
  /**
   * The other agent, for an agent-to-agent thread (`agent__a2-counterpart`).
   * `agentId` renders and answers; `counterpart` is who is asking. Mutually
   * exclusive with `jobId`.
   */
  counterpart?: string
  /**
   * A named chat, for a member with more than one conversation
   * (`agent__c<id>` a later main, `agent__t<id>` a side chat). A chat renders
   * identically to the main thread — it is a conversation, not a different
   * agent — so this is carried for completeness but the render ignores it. The
   * first main chat has no suffix at all (the bare `tenant:agent`).
   */
  chat?: { kind: "main" | "side"; id: number }
}

const JOB_SUFFIX = /^__job-(\d+)$/
const A2A_SUFFIX = /^__a2-([a-z0-9]+(?:-[a-z0-9]+)*)$/
// `c` is a later main chat, `t` a side chat — one letter each, distinct from
// `job`/`a2`, so a chat suffix is never mistaken for a job or a2a session.
const CHAT_SUFFIX = /^__(c|t)(\d+)$/

/**
 * Read a session key. Returns undefined for anything malformed rather than
 * throwing: the caller is usually a request handler that owes a 403 or a 404,
 * and every one of them has a better answer than a stack trace.
 */
export function parseSessionKey(sessionKey: string): SessionIdentity | undefined {
  const separator = sessionKey.indexOf(":")
  if (separator <= 0) return undefined

  const tenantId = sessionKey.slice(0, separator)
  const rest = sessionKey.slice(separator + 1)
  if (!TenantId.safeParse(tenantId).success) return undefined

  const suffixStart = rest.indexOf("__")
  const agentId = suffixStart === -1 ? rest : rest.slice(0, suffixStart)
  if (!AgentId.safeParse(agentId).success) return undefined
  if (suffixStart === -1) return { tenantId, agentId }

  const suffix = rest.slice(suffixStart)
  const job = JOB_SUFFIX.exec(suffix)
  if (job?.[1]) {
    const jobId = Number(job[1])
    if (!Number.isSafeInteger(jobId)) return undefined
    return { tenantId, agentId, jobId }
  }
  const thread = A2A_SUFFIX.exec(suffix)
  if (thread?.[1] && AgentId.safeParse(thread[1]).success) {
    return { tenantId, agentId, counterpart: thread[1] }
  }
  const chat = CHAT_SUFFIX.exec(suffix)
  if (chat?.[1] && chat[2]) {
    const id = Number(chat[2])
    if (!Number.isSafeInteger(id) || id <= 0) return undefined
    return { tenantId, agentId, chat: { kind: chat[1] === "c" ? "main" : "side", id } }
  }
  return undefined
}

/**
 * Build a session key. Throws on invalid parts — composing is always done from
 * values the server already holds, so bad input here is a bug, not a request.
 */
export function composeSessionKey(identity: SessionIdentity): string {
  const tenantId = TenantId.parse(identity.tenantId)
  const agentId = AgentId.parse(identity.agentId)
  const base = `${tenantId}:${agentId}`
  if (identity.counterpart !== undefined) {
    return `${base}__a2-${AgentId.parse(identity.counterpart)}`
  }
  if (identity.chat !== undefined) {
    return `${base}__${identity.chat.kind === "main" ? "c" : "t"}${identity.chat.id}`
  }
  if (identity.jobId === undefined) return base
  return `${base}__job-${identity.jobId}`
}

/**
 * The tenant a session key belongs to, or undefined if it is not one.
 *
 * This is the value the `/agents/:id` guard compares against the authenticated
 * user, so it is deliberately its own function: the check reads as one line at
 * the call site, and there is exactly one place that decides what "the tenant
 * of a session" means.
 */
export function sessionTenantId(sessionKey: string): string | undefined {
  return parseSessionKey(sessionKey)?.tenantId
}
