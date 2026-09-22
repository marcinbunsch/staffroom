import { useState } from "react"
import { Button } from "../design/index.ts"
import type { AttentionRow } from "../lib/api.ts"

/**
 * One open confirm-gate: what the agent wants to do, with approve / deny.
 * Shared by the chat screen and a job page — both surface the same approvals,
 * the ones a gated tool raises when it suspends a turn. Approving dispatches a
 * fresh turn; denying carries a reason back to the agent.
 */
export function ApprovalCard({
  item,
  onAnswer,
}: {
  item: AttentionRow
  onAnswer: (item: AttentionRow, decision: "approved" | "denied", reason?: string) => Promise<void>
}) {
  const [denying, setDenying] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  async function act(decision: "approved" | "denied") {
    setBusy(true)
    try {
      await onAnswer(item, decision, decision === "denied" ? reason.trim() || undefined : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border border-status-attention bg-surface-panel px-4 py-3">
      <div className="flex items-start gap-2">
        <i className="ti ti-shield-check mt-0.5 text-[15px] text-status-attention" />
        <div className="min-w-0 flex-1">
          <div className="text-secondary font-medium text-ink-primary">{item.title}</div>
          {item.detail && <div className="mt-0.5 text-meta text-ink-muted">{item.detail}</div>}
        </div>
      </div>
      {denying ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            autoFocus
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this denied? (the agent sees this)"
            className="w-full resize-y rounded-control border border-line-strong bg-surface-card px-3 py-2 text-secondary text-ink-primary outline-none focus:border-line-accent"
          />
          <div className="flex gap-2 self-end">
            <Button variant="ghost" disabled={busy} onClick={() => setDenying(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => act("denied")}>
              {busy ? "Denying…" : "Deny"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2 self-end">
          <Button variant="ghost" disabled={busy} onClick={() => setDenying(true)}>
            Deny
          </Button>
          <Button variant="approve" disabled={busy} onClick={() => act("approved")}>
            {busy ? "Approving…" : "Approve"}
          </Button>
        </div>
      )}
    </div>
  )
}
