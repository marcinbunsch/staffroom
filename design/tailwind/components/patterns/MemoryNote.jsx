import React from "react"
import { PrivacyBadge } from "../core/PrivacyBadge.jsx"

/* A sealed note shows its key and its existence, never its content —
   masked with bullet runs, not blurred or omitted. */
export function MemoryNote({ noteKey, body, sealed = false }) {
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
