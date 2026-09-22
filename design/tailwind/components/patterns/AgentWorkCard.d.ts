import * as React from "react"

/**
 * @startingPoint section="Activity" subtitle="Staff AgentWorkCard" viewport="700x220"
 */
export interface AgentWorkCardProps {
  name: string
  initials: string
  status?: "working" | "attention" | "failed" | "idle"
  /** Plain-language current work label. */
  work: React.ReactNode
  progress?: number | null
  /** Mono footer, left: step or counts. */
  left?: React.ReactNode
  /** Mono footer, right: elapsed time. */
  right?: React.ReactNode
  onClick?: () => void
}
