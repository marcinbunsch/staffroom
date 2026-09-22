import * as React from "react"

/**
 * @startingPoint section="Jobs" subtitle="Staff TimelineEntry" viewport="700x220"
 */
export interface TimelineEntryProps {
  title: React.ReactNode
  /** Mono clock time, e.g. "13:24". */
  time: React.ReactNode
  /** Node colour = state of that step. */
  state?: "done" | "working" | "attention" | "failed"
  /** Optional detail block: mono tool output, handoff card, artifact. */
  children?: React.ReactNode
  /** Surface behind the node, for the cut-out ring. */
  ringColor?: string
}

export interface TimelineProps {
  children?: React.ReactNode
}
