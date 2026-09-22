# KindChip

Uppercase mono chip naming the _kind_ of an item: DECISION, QUESTION, FAILED, MEMORY UPDATE, COMMITMENTS.

```jsx
<KindChip tone="attention">DECISION</KindChip>
```

Tone must match the item's status; never colour a chip for emphasis.

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

Reference implementation — `tailwind/components/core/KindChip.jsx`:

```jsx
import React from "react"

/* Uppercase mono kind label: DECISION, FAILED, QUESTION, HANDOFF. */
const TONES = {
  attention: "bg-tint-attention text-status-attention border-transparent",
  failed: "bg-tint-failed text-status-failed border-transparent",
  neutral: "bg-line-subtle text-ink-muted border-line-strong",
}

export function KindChip({ children, tone = "neutral" }) {
  return (
    <span
      className={`rounded-[5px] border px-[7px] py-[3px] font-mono text-label tracking-[0.6px] whitespace-nowrap ${
        TONES[tone] || TONES.neutral
      }`}
    >
      {children}
    </span>
  )
}
```
