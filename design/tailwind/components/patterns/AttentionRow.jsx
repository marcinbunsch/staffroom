import React from "react"
import { KindChip } from "../core/KindChip.jsx"
import { Avatar } from "../core/Avatar.jsx"

/* The 3px status spine is a grid column, not a border, so it never rounds
   oddly. Copy answers three questions in order: what stopped, why, and
   what happens if you act. */
export function AttentionRow({
  kind,
  tone = "attention",
  title,
  body,
  agent,
  agentInitials,
  meta,
  badges,
  actions,
}) {
  return (
    <div
      className={`grid grid-cols-[3px_minmax(0,1fr)] overflow-hidden rounded-card border bg-surface-card-hover ${
        tone === "failed" ? "border-line-failed" : "border-line-attention"
      }`}
    >
      <div className={tone === "failed" ? "bg-status-failed" : "bg-status-attention"} />
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3.5 px-5 py-[18px]">
        <div className="min-w-0 flex-[1_1_340px]">
          <div className="flex flex-wrap items-center gap-2">
            <KindChip tone={tone}>{kind}</KindChip>
            <div className="text-body font-semibold">{title}</div>
            {badges}
          </div>
          <div className="mt-2 max-w-copy text-secondary text-ink-muted text-pretty">{body}</div>
          <div className="mt-3 flex items-center gap-3.5 text-meta text-ink-faint">
            {agent ? (
              <span className="flex items-center gap-[7px]">
                <Avatar initials={agentInitials} size="sm" />
                {agent}
              </span>
            ) : null}
            {meta}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  )
}
