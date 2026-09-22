# AgentWorkCard

Live agent card for the Home "Working now" grid.

```jsx
<AgentWorkCard
  name="Ledger"
  initials="LE"
  work="Reconciling July invoices"
  progress={62}
  left="184/297 line items"
  right="21m 40s"
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

Reference implementation — `tailwind/components/patterns/AgentWorkCard.jsx`:

```jsx
import React from "react"
import { Avatar } from "../core/Avatar.jsx"
import { StatusDot } from "../core/StatusDot.jsx"
import { ProgressBar } from "../core/ProgressBar.jsx"

/* Live work. Cards raise their border on hover — they never lift or scale. */
export function AgentWorkCard({
  name,
  initials,
  status = "working",
  work,
  progress = null,
  left,
  right,
  onClick,
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-card border border-line-default bg-surface-card p-[18px] transition-colors duration-[120ms] ease-out ${
        onClick ? "cursor-pointer hover:border-line-accent" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar initials={initials} size="md" />
        <div className="font-semibold">{name}</div>
        <div className="ml-auto">
          <StatusDot status={status} />
        </div>
      </div>
      <div className="mt-3.5 text-secondary text-ink-body">{work}</div>
      <div className="mt-2.5">
        <ProgressBar value={progress} />
      </div>
      <div className="mt-3 flex justify-between font-mono text-mono text-ink-faint">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  )
}
```
