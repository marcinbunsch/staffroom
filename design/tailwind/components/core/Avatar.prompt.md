# Avatar

Agent identity. Staff has no photographs — every agent is a two-letter monogram in a rounded square.

```jsx
<Avatar initials="ST" size="lg" status="working" ringColor="var(--bg-card)" />
```

Always pass `ringColor` matching the surface behind it when `status` is set.

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

Reference implementation — `tailwind/components/core/Avatar.jsx`:

```jsx
import React from "react"
import { StatusDot } from "./StatusDot.jsx"

/* Agents are two-letter monograms. There is no photography in this product. */
const BOX = {
  sm: "w-6 h-6 basis-6 text-label rounded-monogram",
  md: "w-[26px] h-[26px] basis-[26px] text-label rounded-monogram",
  lg: "w-[34px] h-[34px] basis-[34px] text-mono rounded-[9px]",
}

export function Avatar({
  initials,
  size = "md",
  status,
  idle = false,
  ringColor = "var(--surface-panel)",
}) {
  return (
    <div
      className={`relative grid shrink-0 place-items-center font-mono ${BOX[size] || BOX.md} ${
        idle ? "bg-line-subtle text-ink-faint" : "bg-surface-control text-ink-monogram"
      }`}
    >
      {initials}
      {status ? (
        <span
          className="absolute -right-[3px] -bottom-[3px] grid h-2.5 w-2.5 place-items-center rounded-full border-2 bg-transparent"
          style={{ borderColor: ringColor }}
        >
          <StatusDot status={status} size={6} />
        </span>
      ) : null}
    </div>
  )
}
```
