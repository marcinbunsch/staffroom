# UnreadBadge

Amber pill counting unread agent messages. Orthogonal to status — an agent can be idle and unread.

```jsx
<UnreadBadge count={2} />
```

Unread also bolds the agent's name in rosters and rails.

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

Reference implementation — `tailwind/components/core/UnreadBadge.jsx`:

```jsx
import React from "react"

/* Amber, because an unread message is something waiting on you. */
export function UnreadBadge({ count }) {
  if (!count) return null
  return (
    <span className="grid h-[17px] min-w-[17px] place-items-center rounded-[9px] bg-status-attention-fill px-[5px] font-sans text-label font-semibold text-status-attention-ink">
      {count}
    </span>
  )
}
```
