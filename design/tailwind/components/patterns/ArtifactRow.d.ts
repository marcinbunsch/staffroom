import * as React from "react"

export interface ArtifactRowProps {
  /** Three-letter mono type badge: DIF, LOG, MD, TXT, PDF. */
  type: string
  name: React.ReactNode
  meta?: React.ReactNode
  /** working tints the meta line blue for in-progress drafts. */
  metaTone?: "faint" | "working"
  onClick?: () => void
}
