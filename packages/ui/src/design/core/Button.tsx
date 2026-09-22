import type { ReactNode } from "react"

/* Buttons are verbs. One amber `approve` per screen at most — it is the
   only saturated fill in the system. Nothing transforms on press. */

export interface ButtonProps {
  children: ReactNode
  /** approve = amber fill, the only filled colour; one per group. */
  variant?: "approve" | "primary" | "secondary" | "ghost" | "danger"
  disabled?: boolean
  onClick?: () => void
  className?: string
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  approve:
    "bg-status-attention-fill text-status-attention-ink border-transparent font-semibold hover:bg-status-attention-hover px-[15px]",
  primary:
    "bg-surface-control-hover text-ink-primary border-line-control font-medium hover:bg-surface-control-active px-[15px]",
  secondary:
    "bg-transparent text-ink-secondary border-line-strong hover:bg-surface-selected px-[13px]",
  ghost: "bg-transparent text-ink-muted border-transparent hover:text-ink-primary px-[13px]",
  danger:
    "bg-tint-failed text-status-failed-ink border-line-danger font-medium hover:bg-tint-failed-hover px-[13px]",
}

export function Button({
  children,
  variant = "secondary",
  disabled = false,
  onClick,
  className = "",
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`rounded-control border py-2 font-sans text-secondary transition-[background-color,color,border-color] duration-[120ms] ease-out ${
        VARIANTS[variant] ?? VARIANTS.secondary
      } ${disabled ? "cursor-default opacity-55 text-ink-meta hover:bg-transparent" : "cursor-pointer"} ${className}`}
    >
      {children}
    </button>
  )
}
