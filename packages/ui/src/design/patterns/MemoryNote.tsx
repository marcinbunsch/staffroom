import type { ReactNode } from "react"
import { PrivacyBadge } from "../core/PrivacyBadge.tsx"

/* A sealed note shows its key and its existence, never its content —
   masked with bullet runs, not blurred or omitted. */

export interface MemoryNoteProps {
  /** Mono memory key, e.g. "1-1-cadence". */
  noteKey: string
  body?: ReactNode
  /** Sealed notes mask their body and carry a SEALED badge. */
  sealed?: boolean
}

export function MemoryNote({ noteKey, body, sealed = false }: MemoryNoteProps) {
  return (
    <div className="rounded-[11px] border border-line-inset bg-surface-panel px-3.5 py-3">
      <div className="flex items-center gap-[7px]">
        <div className="font-mono text-mono text-status-working-dim">{noteKey}</div>
        {sealed ? <PrivacyBadge>SEALED</PrivacyBadge> : null}
      </div>
      <div
        className={`mt-1.5 text-meta text-pretty ${
          sealed ? "tracking-[0.5px] text-ink-disabled" : "text-ink-muted"
        }`}
      >
        {sealed ? "•••••••• •••• ••••••••• ••• ••••••" : body}
      </div>
    </div>
  )
}
