import * as React from "react"

/**
 * @startingPoint section="Controls" subtitle="Staff Button" viewport="700x220"
 */
export interface ButtonProps {
  children: React.ReactNode
  /** approve = amber fill, the only filled colour; one per group. */
  variant?: "approve" | "primary" | "secondary" | "ghost" | "danger"
  disabled?: boolean
  onClick?: () => void
  className?: string
}
