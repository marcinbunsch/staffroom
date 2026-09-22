# RosterRow

One agent in the Staff roster table. Name bolds when unread; idle rows recede a step.

```jsx
<RosterRow
  name="Devops"
  initials="DE"
  role="Infrastructure & releases"
  status="attention"
  unread={2}
  work="Needs deployment approval"
  stateLabel="needs you · 1h 04m"
  tools={14}
/>
```

---

## Tailwind implementation

Utility classes only. Inline `style` survives in exactly one situation: a value
that cannot exist until runtime (a pixel size passed as a prop, a percentage
width, a ring colour that depends on the surface behind it).

Tokens live in `tailwind/theme.css` and are the whole palette: surfaces
`bg-surface-*`, borders `border-line-*`, text `text-ink-*`, state `*-status-*`,
tints `bg-tint-*`, radii `rounded-chip|monogram|control|row|card|panel`, sizes
`text-title|heading|subheading|body|secondary|meta|mono|label`, motion
`animate-pulse-dot|pulse-ring|bar-slide`. Never a raw hex, never a stock
Tailwind palette colour (`bg-neutral-900`, `text-slate-400`), never
`dark:` — theming is `data-theme` on `<html>` plus the variable layer.

Reference implementation — `tailwind/components/patterns/RosterRow.jsx`:

```jsx
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
```
