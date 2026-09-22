import type { ReactNode } from "react"
import { KindChip } from "../core/KindChip.tsx"
import { Button } from "../core/Button.tsx"

/* Nothing becomes durable without an explicit approval. After a decision
   the row states what happened and stays undoable. */

export interface ProposalRowProps {
  kind: string
  title: ReactNode
  /** CONFIDENTIAL or SHAREABLE. */
  scope?: string
  body: ReactNode
  /** Destination path — always shown, e.g. "→ memory/1-1-cadence · append 1 line". */
  destination: ReactNode
  /** undefined = pending; set to show the decided state. */
  decision?: "approved" | "rejected"
  onApprove?: () => void
  onReject?: () => void
  onEdit?: () => void
  onUndo?: () => void
}

export function ProposalRow({
  kind,
  title,
  scope,
  body,
  destination,
  decision,
  onApprove,
  onReject,
  onEdit,
  onUndo,
}: ProposalRowProps) {
  const saved = decision === "approved"
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-card border border-line-default bg-surface-card px-5 py-[18px]">
      <div className="min-w-0 flex-[1_1_340px]">
        <div className="flex flex-wrap items-center gap-[9px]">
          <KindChip>{kind}</KindChip>
          <div className="text-body font-semibold">{title}</div>
          <div className="font-mono text-label text-status-confidential">{scope}</div>
        </div>
        <div className="mt-[9px] text-secondary text-ink-muted text-pretty">{body}</div>
        <div className="mt-[11px] font-mono text-mono text-ink-label">{destination}</div>
      </div>
      {decision ? (
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={`flex items-center gap-[7px] font-mono text-mono ${
              saved ? "text-status-done" : "text-ink-faint"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-status-done" : "bg-ink-faint"}`}
            />
            {saved ? "SAVED" : "REJECTED"}
          </span>
          <Button variant="ghost" onClick={onUndo}>
            Undo
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onReject}>
            Reject
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="primary" onClick={onApprove}>
            Approve
          </Button>
        </div>
      )}
    </div>
  )
}
