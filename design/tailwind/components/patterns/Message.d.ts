import * as React from "react"

export interface MessageProps {
  /** operator = filled bubble, right-aligned; agent = plain text with avatar gutter. */
  from?: "operator" | "agent"
  initials?: string
  /** Short wall-clock label, e.g. "09:02". Omit for an untimed turn. */
  time?: string
  /** Machine-readable value for the <time> element, e.g. "2026-08-30T09:02". */
  datetime?: string
  children?: React.ReactNode
}
