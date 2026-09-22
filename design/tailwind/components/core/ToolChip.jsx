import React from "react"

/* Tool and scope names are machine facts, so they are mono. */
export function ToolChip({ children }) {
  return (
    <span className="rounded-chip border border-line-strong bg-line-subtle px-[9px] py-[5px] font-mono text-mono text-ink-muted">
      {children}
    </span>
  )
}
