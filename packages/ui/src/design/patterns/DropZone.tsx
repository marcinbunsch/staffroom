/* Dashed border is the only dashed line in the system, reserved for
   "something can be dropped here". */

export interface DropZoneProps {
  label?: string
  /** compact renders the inline header affordance instead of the block target. */
  compact?: boolean
}

export function DropZone({ label = "Drop a file, or paste text", compact = false }: DropZoneProps) {
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
