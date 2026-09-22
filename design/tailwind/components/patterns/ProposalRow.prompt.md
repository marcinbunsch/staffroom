# ProposalRow

A single proposed durable write awaiting operator review. Nothing in Staff persists without one of these.

```jsx
<ProposalRow
  kind="MEMORY UPDATE"
  title="Amend 1-1-cadence note"
  scope="SHAREABLE"
  body="Adds one line; existing text is kept."
  destination="→ memory/1-1-cadence · append 1 line"
  onApprove={approve}
  onReject={reject}
/>
```

Every row carries its own controls; bulk approve is additive, never a substitute.

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

Reference implementation — `tailwind/components/patterns/ProposalRow.jsx`:

```jsx
import React from "react"
import { KindChip } from "../core/KindChip.jsx"
import { Button } from "../core/Button.jsx"

/* Nothing becomes durable without an explicit approval. After a decision
   the row states what happened and stays undoable. */
export function ProposalRow({
  kind,
  title,
  scope,
  body,
  destination,
  decision,
  onApprove,
  onReject,
  onEdit,
  onUndo,
}) {
  const saved = decision === "approved"
  return (
    <div className="flex flex-wrap items-start gap-4 rounded-card border border-line-default bg-surface-card px-5 py-[18px]">
      <div className="min-w-0 flex-[1_1_340px]">
        <div className="flex flex-wrap items-center gap-[9px]">
          <KindChip>{kind}</KindChip>
          <div className="text-body font-semibold">{title}</div>
          <div className="font-mono text-label text-status-confidential">{scope}</div>
        </div>
        <div className="mt-[9px] text-secondary text-ink-muted text-pretty">{body}</div>
        <div className="mt-[11px] font-mono text-mono text-ink-label">{destination}</div>
      </div>
      {decision ? (
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className={`flex items-center gap-[7px] font-mono text-mono ${saved ? "text-status-done" : "text-ink-faint"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${saved ? "bg-status-done" : "bg-ink-faint"}`}
            />
            {saved ? "SAVED" : "REJECTED"}
          </span>
          <Button variant="ghost" onClick={onUndo}>
            Undo
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onReject}>
            Reject
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="primary" onClick={onApprove}>
            Approve
          </Button>
        </div>
      )}
    </div>
  )
}
```
