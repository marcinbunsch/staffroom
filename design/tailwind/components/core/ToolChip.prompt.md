# ToolChip

Neutral mono chip for a granted tool or MCP connection (`cloud-run`, `mcp:notion`).

```jsx
<ToolChip>cloud-monitoring</ToolChip>
```

Tools are permissions, so they are never coloured — colour would imply state.

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

Reference implementation — `tailwind/components/core/ToolChip.jsx`:

```jsx
import React from "react"

/* Tool and scope names are machine facts, so they are mono. */
export function ToolChip({ children }) {
  return (
    <span className="rounded-chip border border-line-strong bg-line-subtle px-[9px] py-[5px] font-mono text-mono text-ink-muted">
      {children}
    </span>
  )
}
```
