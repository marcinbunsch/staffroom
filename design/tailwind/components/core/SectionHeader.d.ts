import * as React from "react"

export interface SectionHeaderProps {
  children: React.ReactNode
  /** attention for "Needs you", working for "Working now", neutral otherwise. */
  tone?: "attention" | "working" | "neutral"
  /** Right-aligned mono count, e.g. "3 open · 1 failure". */
  meta?: React.ReactNode
}
