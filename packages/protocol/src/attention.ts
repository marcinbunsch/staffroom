import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * Confirm-gates, and the operator attention they raise.
 *
 * "Prompt-injection hardened" is not reachable as a property of prompts. What
 * is reachable is that a compromised turn cannot do lasting damage: an outbound
 * or irreversible tool call — sending mail, deleting, spending — is gated, and
 * the operator sees "send mail to attacker@evil.com" and does not approve.
 *
 * The gate **suspends; it does not block.** A tool call that blocked until a
 * human answered would trip Flue's one-hour submission timeout, be reclaimed
 * and retried up to ten times, re-doing whatever it already did. So instead the
 * gated call raises an attention request, returns immediately, and the turn
 * settles with no lease held. The operator's answer dispatches a *new turn*
 * into the same session — a resumed job, not a resumed tool call. That is the
 * only shape that survives an overnight wait.
 */
export const ApprovalState = z.enum(["pending", "approved", "denied", "cancelled"])

export const Approval = z.object({
  id: z.string(),
  tenantId: TenantId,
  /** Null for a gate raised in a plain chat rather than a job. */
  jobId: z.number().int().nullable(),
  session: z.string(),
  agent: AgentId,
  tool: z.string(),
  /** Binds the one-shot token to this exact call — without it, approve forever. */
  argumentsHash: z.string(),
  /** A short human summary of what is being asked, for the operator's card. */
  summary: z.string(),
  state: ApprovalState,
  reason: z.string().nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
})

/**
 * A durable operator follow-up.
 *
 * `approval` is the confirm-gate's own kind (v2): it carries an approval and is
 * answered approve/deny. The rest are what an agent raises for itself through
 * `attention_request` when it needs a person — a `question` it cannot answer, a
 * `decision` only the operator can make, a `review` of something it produced, or
 * a `failure` it hit and stopped on. Those are resolved (with an answer) or
 * dismissed (stood down, with a reason).
 */
export const AttentionKind = z.enum(["approval", "question", "decision", "review", "failure"])
/** The kinds an agent may raise itself — everything but the gate's `approval`. */
export const RequestKind = z.enum(["question", "decision", "review", "failure"])
export const AttentionStatus = z.enum(["open", "resolved", "dismissed"])

export const AttentionItem = z.object({
  id: z.string(),
  tenantId: TenantId,
  agent: AgentId,
  kind: AttentionKind,
  title: z.string(),
  detail: z.string().nullable(),
  status: AttentionStatus,
  session: z.string(),
  jobId: z.number().int().nullable(),
  /** For an approval item, the approval it is waiting on. */
  approvalId: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
})

export type ApprovalState = z.infer<typeof ApprovalState>
export type Approval = z.infer<typeof Approval>
export type AttentionKind = z.infer<typeof AttentionKind>
export type RequestKind = z.infer<typeof RequestKind>
export type AttentionStatus = z.infer<typeof AttentionStatus>
export type AttentionItem = z.infer<typeof AttentionItem>
