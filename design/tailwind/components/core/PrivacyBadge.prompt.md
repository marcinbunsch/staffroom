# PrivacyBadge

Teal badge marking protected material. Reassures by stating mechanics; never uses red or a warning tone.

```jsx
<PrivacyBadge>CONFIDENTIAL</PrivacyBadge>
<PrivacyBadge dot>PRIVATE THREAD · LOCAL ONLY</PrivacyBadge>
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

Reference implementation — `tailwind/components/core/PrivacyBadge.jsx`:

```jsx
import React from "react"

/* Teal, never red: privacy copy reassures by describing mechanics,
   it does not warn. No shield icons. */
export function PrivacyBadge({ children = "CONFIDENTIAL", dot = false }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-line-confidential bg-surface-confidential px-2 py-[3px] font-mono text-label text-status-confidential">
      {dot ? <span className="h-[5px] w-[5px] rounded-full bg-status-confidential" /> : null}
      {children}
    </span>
  )
}
```
