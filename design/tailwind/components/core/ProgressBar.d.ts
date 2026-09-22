import * as React from "react"

export interface ProgressBarProps {
  /** 0–100 for known progress; null/undefined for indeterminate (sliding bar). */
  value?: number | null
}
