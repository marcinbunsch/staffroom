# DropZone

Upload target for the Inbox. Uploads never write to memory directly — they produce reviewable proposals.

```jsx
<DropZone />
<DropZone compact label="Drop a file, or paste text" />
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

Reference implementation — `tailwind/components/patterns/DropZone.jsx`:

```jsx
import React from "react"

/* Dashed border is the only dashed line in the system, reserved for
   "something can be dropped here". */
export function DropZone({ label = "Drop a file, or paste text", compact = false }) {
  return (
    <div
      className={`cursor-pointer border border-dashed border-line-strong text-secondary text-ink-meta ${
        compact ? "rounded-[9px] px-[13px] py-2 text-left" : "rounded-card p-4 text-center"
      }`}
    >
      {label}
    </div>
  )
}
```
