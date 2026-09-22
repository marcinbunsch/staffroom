import React from "react"

/* Dashed border is the only dashed line in the system, reserved for
   "something can be dropped here". */
export function DropZone({ label = "Drop a file, or paste text", compact = false }) {
  return (
    <div
      className={`cursor-pointer border border-dashed border-line-strong text-secondary text-ink-meta ${
        compact ? "rounded-[9px] px-[13px] py-2 text-left" : "rounded-card p-4 text-center"
      }`}
    >
      {label}
    </div>
  )
}
