import React from "react"
import { Avatar } from "../core/Avatar.jsx"
import { UnreadBadge } from "../core/UnreadBadge.jsx"

/* Idle agents recede a full text step rather than disappearing.
   The three tracks collapse on narrow screens via flex-basis, not a
   breakpoint — see rules.md on responsive behaviour. */
const STATE_TEXT = {
  failed: "text-status-failed",
  attention: "text-status-attention",
  working: "text-status-working",
  idle: "text-ink-label",
}

export function RosterRow({
  name,
  initials,
  role,
  status = "idle",
  unread = 0,
  work,
  stateLabel,
  tools,
  selected = false,
  onClick,
}) {
  const idle = status === "idle"
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer flex-wrap items-center gap-4 border-b border-line-subtle px-5 py-4 ${
        selected ? "bg-surface-card" : "bg-transparent hover:bg-surface-hover"
      }`}
    >
      <div className="flex min-w-0 flex-[1_1_260px] items-center gap-[13px]">
        <Avatar
          initials={initials}
          size="lg"
          status={idle ? undefined : status}
          idle={idle}
          ringColor={selected ? "var(--surface-card)" : "var(--surface-panel)"}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`${unread ? "font-semibold" : "font-medium"} ${idle ? "text-ink-muted" : "text-ink-primary"}`}
            >
              {name}
            </span>
            <UnreadBadge count={unread} />
          </div>
          <div className={`mt-0.5 text-meta ${idle ? "text-ink-faint" : "text-ink-meta"}`}>
            {role}
          </div>
        </div>
      </div>
      <div
        className={`flex-[1_1_190px] text-secondary ${idle ? "text-ink-faint" : "text-ink-secondary"}`}
      >
        {work}
        <div className={`mt-[3px] font-mono text-mono ${STATE_TEXT[status] || STATE_TEXT.idle}`}>
          {stateLabel}
        </div>
      </div>
      <div className="flex-[0_0_110px] text-right font-mono text-mono text-ink-faint">{tools}</div>
    </div>
  )
}
