import { createHash, randomUUID } from "node:crypto"
import {
  type Approval,
  Approval as ApprovalSchema,
  type AttentionItem,
  AttentionItem as AttentionItemSchema,
  type RequestKind,
} from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"
import { getOperatorEvents } from "./operator-events.ts"
import type { ApprovalTable, AttentionTable } from "./schema.ts"

/**
 * A raise worth telling the operator about, out of band. The store raises the
 * durable item and rings the (content-free) operator bus; this carries the
 * content a push notification needs. Wired in `app.ts` to the push dispatcher,
 * a seam rather than a direct import because `push.ts` reads back through this
 * store for the badge count — importing it here would be a cycle.
 */
export interface AttentionNotification {
  tenantId: string
  agent: string
  session: string
  /** `question` | `decision` | `review` | `failure` | `approval`. */
  kind: string
  title: string
  detail: string | null
}

type AttentionNotifier = (notification: AttentionNotification) => void

let notifier: AttentionNotifier | undefined

/** Wire (or clear) the out-of-band notifier the store rings on a fresh raise. */
export function setAttentionNotifier(fn: AttentionNotifier | undefined): void {
  notifier = fn
}

function notify(notification: AttentionNotification): void {
  if (!notifier) return
  // A throwing notifier must never break the raise that rang it — the durable
  // item is the source of truth; the push is a courtesy on top.
  try {
    notifier(notification)
  } catch (error) {
    console.warn("[attention] notifier threw:", error)
  }
}

/** Stable hash of a tool's arguments, so an approval binds to this exact call. */
export function hashArguments(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex")
    .slice(0, 32)
}

export interface RaiseApprovalInput {
  tenantId: string
  jobId: number | null
  session: string
  agent: string
  tool: string
  argumentsHash: string
  summary: string
}

/**
 * The confirm-gate's durable state: pending approvals, and the operator
 * attention items that surface them.
 *
 * The one-shot rule lives in {@link consumeApproval}: an approval matches a
 * call by `(session, tool, argumentsHash)` and is spent the moment it is used,
 * so a re-issued call without a fresh approval hits the gate again rather than
 * being waved through forever.
 */
export class AttentionStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /** Ring the operator bus — the attention board changed for this tenant. */
  #announce(tenantId: string): void {
    getOperatorEvents().publish({ tenantId, event: { type: "attention.changed" } })
  }

  /**
   * Raise a pending approval and the attention item that surfaces it. Returns
   * the approval so the caller can reference it. The gate calls this and then
   * returns a "needs approval" message, ending the turn.
   */
  raise(input: RaiseApprovalInput): Approval {
    const approvalId = randomUUID()
    const now = new Date().toISOString()
    this.#db.transaction(() => {
      this.#db.run(
        this.#db.qb.insertInto("approvals").values({
          id: approvalId,
          tenant_id: input.tenantId,
          job_id: input.jobId,
          session: input.session,
          agent: input.agent,
          tool: input.tool,
          arguments_hash: input.argumentsHash,
          summary: input.summary,
          state: "pending",
          reason: null,
          created_at: now,
          answered_at: null,
        }),
      )
      this.#db.run(
        this.#db.qb.insertInto("attention").values({
          id: randomUUID(),
          tenant_id: input.tenantId,
          agent: input.agent,
          kind: "approval",
          title: `Approve: ${input.tool}`,
          detail: input.summary,
          status: "open",
          session: input.session,
          job_id: input.jobId,
          approval_id: approvalId,
          created_at: now,
          resolved_at: null,
        }),
      )
    })
    this.#announce(input.tenantId)
    notify({
      tenantId: input.tenantId,
      agent: input.agent,
      session: input.session,
      kind: "approval",
      title: `Approve: ${input.tool}`,
      detail: input.summary,
    })
    return this.#requireApproval(approvalId)
  }

  /**
   * Raise an agent-initiated request — the `attention_request` tool. The agent
   * needs a person: a `question` it cannot answer, a `decision` only the operator
   * can make, a `review`, or a `failure` it hit and stopped on. Same durable row
   * as an approval, but with a request `kind` and no approval — it is resolved
   * (with an answer) or dismissed (with a reason), and either resumes the turn.
   *
   * Deduped on `(session, kind, title)` while open, so a model that re-calls the
   * tool before anyone answers does not stack identical items.
   */
  raiseRequest(input: {
    tenantId: string
    agent: string
    session: string
    jobId: number | null
    kind: RequestKind
    title: string
    detail: string | null
  }): AttentionItem {
    const existing = this.#db.get(
      this.#db.qb
        .selectFrom("attention")
        .select("id")
        .where("tenant_id", "=", input.tenantId)
        .where("session", "=", input.session)
        .where("kind", "=", input.kind)
        .where("title", "=", input.title)
        .where("status", "=", "open"),
    )
    if (existing) return this.#requireItem(existing.id)

    const id = randomUUID()
    const now = new Date().toISOString()
    this.#db.run(
      this.#db.qb.insertInto("attention").values({
        id,
        tenant_id: input.tenantId,
        agent: input.agent,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        status: "open",
        session: input.session,
        job_id: input.jobId,
        approval_id: null,
        created_at: now,
        resolved_at: null,
      }),
    )
    this.#announce(input.tenantId)
    notify({
      tenantId: input.tenantId,
      agent: input.agent,
      session: input.session,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
    })
    return this.#requireItem(id)
  }

  /**
   * The operator resolves a request (answers it) or dismisses it (stands the
   * agent down). Both close the item and return it, so the route can deliver the
   * note as a new turn into its session. Only open, non-approval items — an
   * approval goes through {@link answer}.
   */
  resolveRequest(tenantId: string, id: string): AttentionItem | undefined {
    return this.#closeRequest(tenantId, id, "resolved")
  }

  dismissRequest(tenantId: string, id: string): AttentionItem | undefined {
    return this.#closeRequest(tenantId, id, "dismissed")
  }

  #closeRequest(
    tenantId: string,
    id: string,
    status: "resolved" | "dismissed",
  ): AttentionItem | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("attention")
        .selectAll()
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId)
        .where("kind", "!=", "approval")
        .where("status", "=", "open"),
    )
    if (!row) return undefined
    this.#db.run(
      this.#db.qb
        .updateTable("attention")
        .set({ status, resolved_at: new Date().toISOString() })
        .where("id", "=", id),
    )
    this.#announce(tenantId)
    return this.#requireItem(id)
  }

  /** Whether a pending approval already exists for this exact call (avoid dupes). */
  pendingFor(session: string, tool: string, argumentsHash: string): boolean {
    return (
      this.#db.get(
        this.#db.qb
          .selectFrom("approvals")
          .select("id")
          .where("session", "=", session)
          .where("tool", "=", tool)
          .where("arguments_hash", "=", argumentsHash)
          .where("state", "=", "pending"),
      ) !== undefined
    )
  }

  /**
   * Consume an approved approval for this exact call, if one exists. One-shot:
   * the row moves to a terminal-for-matching state so a second identical call
   * finds nothing. Returns true when a call may proceed.
   */
  consumeApproval(session: string, tool: string, argumentsHash: string): boolean {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("approvals")
        .select("id")
        .where("session", "=", session)
        .where("tool", "=", tool)
        .where("arguments_hash", "=", argumentsHash)
        .where("state", "=", "approved"),
    )
    if (!row) return false
    // Mark it consumed so it cannot approve a second identical call.
    this.#db.run(
      this.#db.qb
        .updateTable("approvals")
        .set({ state: "consumed" })
        .where("id", "=", row.id)
        .where("state", "=", "approved"),
    )
    return true
  }

  /** The operator answers. Approving flips the approval; the caller re-dispatches. */
  answer(
    tenantId: string,
    approvalId: string,
    decision: "approved" | "denied",
    reason?: string,
  ): Approval | undefined {
    const approval = this.#db.get(
      this.#db.qb
        .selectFrom("approvals")
        .selectAll()
        .where("id", "=", approvalId)
        .where("tenant_id", "=", tenantId)
        .where("state", "=", "pending"),
    )
    if (!approval) return undefined
    const now = new Date().toISOString()
    this.#db.transaction(() => {
      this.#db.run(
        this.#db.qb
          .updateTable("approvals")
          .set({ state: decision, reason: reason ?? null, answered_at: now })
          .where("id", "=", approvalId),
      )
      this.#db.run(
        this.#db.qb
          .updateTable("attention")
          .set({ status: "resolved", resolved_at: now })
          .where("approval_id", "=", approvalId),
      )
    })
    this.#announce(tenantId)
    return this.#requireApproval(approvalId)
  }

  /**
   * Cancel every pending approval for a job — called when its deadline expires,
   * so a late approval can never wake a dead job. Returns the cancelled count.
   */
  cancelForJob(tenantId: string, jobId: number): number {
    const now = new Date().toISOString()
    const changed = this.#db.run(
      this.#db.qb
        .updateTable("approvals")
        .set({ state: "cancelled", answered_at: now })
        .where("tenant_id", "=", tenantId)
        .where("job_id", "=", jobId)
        .where("state", "=", "pending"),
    ).changes
    this.#db.run(
      this.#db.qb
        .updateTable("attention")
        .set({ status: "dismissed", resolved_at: now })
        .where("tenant_id", "=", tenantId)
        .where("job_id", "=", jobId)
        .where("status", "=", "open"),
    )
    return changed
  }

  getApproval(tenantId: string, approvalId: string): Approval | undefined {
    const row = this.#db.get(
      this.#db.qb
        .selectFrom("approvals")
        .selectAll()
        .where("id", "=", approvalId)
        .where("tenant_id", "=", tenantId),
    )
    return row ? rowToApproval(row) : undefined
  }

  /** Open attention items for the operator's board, tenant-scoped. */
  open(tenantId: string): AttentionItem[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("attention")
          .selectAll()
          .where("tenant_id", "=", tenantId)
          .where("status", "=", "open")
          .orderBy("created_at", "desc"),
      )
      .map(rowToAttention)
  }

  #requireApproval(id: string): Approval {
    const row = this.#db.get(this.#db.qb.selectFrom("approvals").selectAll().where("id", "=", id))
    if (!row) throw new Error(`approval "${id}" did not persist`)
    return rowToApproval(row)
  }

  #requireItem(id: string): AttentionItem {
    const row = this.#db.get(this.#db.qb.selectFrom("attention").selectAll().where("id", "=", id))
    if (!row) throw new Error(`attention item "${id}" did not persist`)
    return rowToAttention(row)
  }
}

function rowToApproval(row: ApprovalTable): Approval {
  return ApprovalSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    jobId: row.job_id ?? null,
    session: row.session,
    agent: row.agent,
    tool: row.tool,
    argumentsHash: row.arguments_hash,
    summary: row.summary,
    // "consumed" is an internal state past "approved"; present it as approved.
    state: row.state === "consumed" ? "approved" : row.state,
    reason: row.reason ?? null,
    createdAt: row.created_at,
    answeredAt: row.answered_at ?? null,
  })
}

function rowToAttention(row: AttentionTable): AttentionItem {
  return AttentionItemSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    agent: row.agent,
    kind: row.kind,
    title: row.title,
    detail: row.detail ?? null,
    status: row.status,
    session: row.session,
    jobId: row.job_id ?? null,
    approvalId: row.approval_id ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  })
}

let store: AttentionStore | undefined

export function getAttentionStore(): AttentionStore {
  if (!store) store = new AttentionStore(getDatabase())
  return store
}
