import * as React from "react"

export interface KindChipProps {
  children: React.ReactNode
  /** attention (DECISION, QUESTION) · failed (FAILED) · neutral (write kinds). */
  tone?: "attention" | "failed" | "neutral"
}
