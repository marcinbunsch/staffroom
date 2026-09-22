# ProgressBar

2px job progress bar. Determinate fills; unknown progress slides.

```jsx
<ProgressBar value={62} />
<ProgressBar />
```

Only ever shown for live work.

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

Reference implementation — `tailwind/components/core/ProgressBar.jsx`:

```jsx
import React from "react"

/* value === null means the work is running but its extent is unknown —
   the bar slides instead of filling. */
export function ProgressBar({ value = null }) {
  const indeterminate = value === null || value === undefined
  return (
    <div className="h-0.5 overflow-hidden rounded-[2px] bg-surface-inset">
      <div
        className={`h-full bg-status-working ${indeterminate ? "w-[30%] animate-bar-slide" : ""}`}
        style={indeterminate ? undefined : { width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}
```
