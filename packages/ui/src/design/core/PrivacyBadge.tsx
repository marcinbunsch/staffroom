import type { ReactNode } from "react"

/* Teal, never red: privacy copy reassures by describing mechanics,
   it does not warn. No shield icons. */

export interface PrivacyBadgeProps {
  /** CONFIDENTIAL · SEALED · PRIVATE THREAD · ENC. */
  children?: ReactNode
  /** Leading teal dot, used on queue items. */
  dot?: boolean
}

export function PrivacyBadge({ children = "CONFIDENTIAL", dot = false }: PrivacyBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-line-confidential bg-surface-confidential px-2 py-[3px] font-mono text-label text-status-confidential">
      {dot ? <span className="h-[5px] w-[5px] rounded-full bg-status-confidential" /> : null}
      {children}
    </span>
  )
}
