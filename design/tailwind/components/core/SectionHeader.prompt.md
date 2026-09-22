# SectionHeader

Uppercase kicker + fading hairline + optional mono count. Sets the rhythm of every screen.

```jsx
<SectionHeader tone="attention" meta="3 open · 1 failure">
  Needs you
</SectionHeader>
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

Reference implementation — `tailwind/components/core/SectionHeader.jsx`:

```jsx
import React from "react"

/* Uppercase kicker + hairline that fades from a status tint to the subtle
   border + optional mono count. This rhythm repeats on every screen. */
const TONES = {
  attention: { text: "text-status-attention", rule: "from-line-attention" },
  working: { text: "text-status-working-dim", rule: "from-line-accent" },
  neutral: { text: "text-ink-meta", rule: "from-line-subtle" },
}

export function SectionHeader({ children, tone = "neutral", meta }) {
  const t = TONES[tone] || TONES.neutral
  return (
    <div className="flex items-center gap-3">
      <div className={`font-sans text-meta font-semibold tracking-[0.8px] uppercase ${t.text}`}>
        {children}
      </div>
      <div className={`h-px flex-1 bg-gradient-to-r to-line-subtle ${t.rule}`} />
      {meta ? <div className="font-mono text-mono text-ink-faint">{meta}</div> : null}
    </div>
  )
}
```
