# MemoryNote

A durable note an agent keeps in mind. Sealed notes exist but never render their contents.

```jsx
<MemoryNote noteKey="comp-discussions" sealed />
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

Reference implementation — `tailwind/components/patterns/MemoryNote.jsx`:

```jsx
import React from "react"
import { PrivacyBadge } from "../core/PrivacyBadge.jsx"

/* A sealed note shows its key and its existence, never its content —
   masked with bullet runs, not blurred or omitted. */
export function MemoryNote({ noteKey, body, sealed = false }) {
  return (
    <div className="rounded-[11px] border border-line-inset bg-surface-panel px-3.5 py-3">
      <div className="flex items-center gap-[7px]">
        <div className="font-mono text-mono text-status-working-dim">{noteKey}</div>
        {sealed ? <PrivacyBadge>SEALED</PrivacyBadge> : null}
      </div>
      <div
        className={`mt-1.5 text-meta text-pretty ${
          sealed ? "tracking-[0.5px] text-ink-disabled" : "text-ink-muted"
        }`}
      >
        {sealed ? "•••••••• •••• ••••••••• ••• ••••••" : body}
      </div>
    </div>
  )
}
```
