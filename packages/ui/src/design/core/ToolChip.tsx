import type { ReactNode } from "react"

/* Tool and scope names are machine facts, so they are mono. */

export interface ToolChipProps {
  children: ReactNode
}

export function ToolChip({ children }: ToolChipProps) {
  return (
    <span className="rounded-chip border border-line-strong bg-line-subtle px-[9px] py-[5px] font-mono text-mono text-ink-muted">
      {children}
    </span>
  )
}
