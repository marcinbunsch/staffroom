import * as React from "react"

/**
 * @startingPoint section="Roster" subtitle="Staff RosterRow" viewport="700x220"
 */
export interface RosterRowProps {
  name: string
  initials: string
  role: string
  status?: "failed" | "attention" | "working" | "idle"
  unread?: number
  work: React.ReactNode
  /** Mono state line, e.g. "working · 6m 12s". */
  stateLabel: React.ReactNode
  /** Granted tool count. */
  tools?: React.ReactNode
  selected?: boolean
  onClick?: () => void
}
