# StatusDot

The single most important indicator in Staff: a coloured dot carrying an agent or job state. Use it anywhere a state must be legible at a glance.

```jsx
<StatusDot status="working" ring />
<StatusDot status="failed" size={9} />
```

Only `working` animates (2.4s pulse); idle, failed and done are static by design. Never replace a status dot with an icon or a text label alone.

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

Reference implementation — `tailwind/components/core/StatusDot.jsx`:

```jsx
import React from "react"

/* Status is a dot, never a glyph and never a coloured label.
   Only `working` animates. */
const COLOR = {
  failed: "bg-status-failed",
  attention: "bg-status-attention",
  working: "bg-status-working",
  done: "bg-status-done",
  idle: "bg-status-idle",
  confidential: "bg-status-confidential",
}
const RING = {
  failed: "border-status-failed",
  attention: "border-status-attention",
  working: "border-status-working",
  done: "border-status-done",
  idle: "border-status-idle",
  confidential: "border-status-confidential",
}

export function StatusDot({ status = "idle", size = 7, ring = false, ringColor }) {
  const live = status === "working"
  const fill = COLOR[status] || COLOR.idle
  const stroke = RING[status] || RING.idle
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size, flexBasis: size }}
    >
      <span
        className={`absolute inset-0 rounded-full ${fill} ${live ? "animate-pulse-dot" : ""}`}
      />
      {ring && live ? (
        <span className={`absolute inset-0 rounded-full border ${stroke} animate-pulse-ring`} />
      ) : null}
      {ringColor ? (
        <span
          className="absolute -inset-0.5 rounded-full border-2"
          style={{ borderColor: ringColor }}
        />
      ) : null}
    </span>
  )
}
```
