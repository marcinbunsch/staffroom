import * as React from "react"

/**
 * @startingPoint section="Attention" subtitle="Staff ProposalRow" viewport="700x220"
 */
export interface ProposalRowProps {
  kind: string
  title: React.ReactNode
  /** CONFIDENTIAL or SHAREABLE. */
  scope?: string
  body: React.ReactNode
  /** Destination path — always shown, e.g. "→ memory/1-1-cadence · append 1 line". */
  destination: React.ReactNode
  /** undefined = pending; set to show the decided state. */
  decision?: "approved" | "rejected"
  onApprove?: () => void
  onReject?: () => void
  onEdit?: () => void
  onUndo?: () => void
}
