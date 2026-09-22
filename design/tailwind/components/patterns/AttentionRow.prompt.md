# AttentionRow

The highest-priority row in the product: something is blocked on the operator. Used only inside the "Needs you" section.

```jsx
<AttentionRow
  kind="DECISION"
  title="Deploy api-gateway v2.14 to production"
  body="Canary held at 5% for 40 minutes with no error-rate change."
  agent="Devops"
  agentInitials="DE"
  meta={<span>waiting 1h 04m</span>}
  actions={
    <>
      <Button>Later</Button>
      <Button variant="approve">Approve</Button>
    </>
  }
/>
```

A 3px status spine is a grid column, not a border. Max three of these visible at rest.

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

Reference implementation — `tailwind/components/patterns/AttentionRow.jsx`:

```jsx
import React from "react"
import { KindChip } from "../core/KindChip.jsx"
import { Avatar } from "../core/Avatar.jsx"

/* The 3px status spine is a grid column, not a border, so it never rounds
   oddly. Copy answers three questions in order: what stopped, why, and
   what happens if you act. */
export function AttentionRow({
  kind,
  tone = "attention",
  title,
  body,
  agent,
  agentInitials,
  meta,
  badges,
  actions,
}) {
  return (
    <div
      className={`grid grid-cols-[3px_minmax(0,1fr)] overflow-hidden rounded-card border bg-surface-card-hover ${
        tone === "failed" ? "border-line-failed" : "border-line-attention"
      }`}
    >
      <div className={tone === "failed" ? "bg-status-failed" : "bg-status-attention"} />
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3.5 px-5 py-[18px]">
        <div className="min-w-0 flex-[1_1_340px]">
          <div className="flex flex-wrap items-center gap-2">
            <KindChip tone={tone}>{kind}</KindChip>
            <div className="text-body font-semibold">{title}</div>
            {badges}
          </div>
          <div className="mt-2 max-w-copy text-secondary text-ink-muted text-pretty">{body}</div>
          <div className="mt-3 flex items-center gap-3.5 text-meta text-ink-faint">
            {agent ? (
              <span className="flex items-center gap-[7px]">
                <Avatar initials={agentInitials} size="sm" />
                {agent}
              </span>
            ) : null}
            {meta}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
    </div>
  )
}
```
