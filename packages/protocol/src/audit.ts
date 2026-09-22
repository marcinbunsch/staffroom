import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * The append-only record of what agents did and what it cost.
 *
 * Two things about the shape are decisions rather than convenience. Usage is
 * **columns**, not a blob: the prototype captured Flue's pricing and buried it
 * in JSON, and a spend page over JSON is a scan and a parse where it should be
 * a `GROUP BY`. And `tenantId` is on every row, because "what did this cost"
 * is a per-person question long before it is an organizational one.
 *
 * Cost you did not record cannot be backfilled, which is why this arrives
 * before jobs, tools or anything else that spends.
 */
export const AuditActor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), id: AgentId }),
  z.object({ kind: z.literal("operator") }),
  z.object({ kind: z.literal("system") }),
])

export const AuditEventType = z.enum(["agent.start", "agent.end", "model.turn", "tool.call"])

/** What one model turn consumed, priced by Flue against the model's own table. */
export const AuditUsage = z.object({
  model: z.string().nullable(),
  /** Which credential paid, so an org key and a personal one can be told apart. */
  credentialId: z.string().nullable(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  costTotal: z.number().nonnegative(),
})

export const AuditEvent = z.object({
  id: z.string(),
  /** Insertion order. The log is read newest-first and replayed oldest-first. */
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  tenantId: TenantId,
  actor: AuditActor,
  agent: AgentId.nullable(),
  /** The session this happened in, so a job's spend can be summed later. */
  session: z.string().nullable(),
  jobId: z.number().int().nullable(),
  type: AuditEventType,
  usage: AuditUsage,
  /** Everything not worth a column: tool names, durations, error flags. */
  payload: z.record(z.string(), z.unknown()),
})

export const AuditEventInput = AuditEvent.omit({ id: true, sequence: true, timestamp: true })

/** One row of the spend page: a total, grouped by whatever was asked for. */
export const SpendRow = z.object({
  key: z.string(),
  turns: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  costTotal: z.number().nonnegative(),
})

export type AuditActor = z.infer<typeof AuditActor>
export type AuditEventType = z.infer<typeof AuditEventType>
export type AuditUsage = z.infer<typeof AuditUsage>
export type AuditEvent = z.infer<typeof AuditEvent>
export type AuditEventInput = z.infer<typeof AuditEventInput>
export type SpendRow = z.infer<typeof SpendRow>

/** No usage — what every non-model event records. */
export const NO_USAGE: AuditUsage = {
  model: null,
  credentialId: null,
  tokensIn: 0,
  tokensOut: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costTotal: 0,
}
