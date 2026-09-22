import React from "react"

/* value === null means the work is running but its extent is unknown —
   the bar slides instead of filling. */
export function ProgressBar({ value = null }) {
  const indeterminate = value === null || value === undefined
  return (
    <div className="h-0.5 overflow-hidden rounded-[2px] bg-surface-inset">
      <div
        className={`h-full bg-status-working ${indeterminate ? "w-[30%] animate-bar-slide" : ""}`}
        style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}
