# TimelineEntry

Chronological job history. `Timeline` draws the rail; each `TimelineEntry` is one step.

```jsx
<Timeline>
  <TimelineEntry title="Assigned by you" time="12:41" />
  <TimelineEntry title="Paused for your approval" time="14:02" state="attention" />
</Timeline>
```

Tool output goes in a mono block inside `children`, never as prose.

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

Reference implementation — `tailwind/components/patterns/TimelineEntry.jsx`:

```jsx
import React from "react"

/* Job history. Node colour is the state; only the title of an attention
   entry takes colour, never the body. */
const NODE = {
  done: "bg-status-idle",
  working: "bg-status-working",
  attention: "bg-status-attention",
  failed: "bg-status-failed",
}

export function TimelineEntry({
  title,
  time,
  state = "done",
  children,
  ringColor = "var(--surface-canvas)",
}) {
  return (
    <div className="relative">
      <div
        className={`absolute -left-[27px] top-[5px] h-[9px] w-[9px] rounded-full border-2 ${NODE[state] || NODE.done}`}
        style={{ borderColor: ringColor }}
      />
      <div className="flex items-baseline gap-3">
        <div
          className={`text-secondary font-semibold ${state === "attention" ? "text-status-attention" : "text-ink-primary"}`}
        >
          {title}
        </div>
        <div className="font-mono text-mono text-ink-label">{time}</div>
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}

export function Timeline({ children }) {
  return (
    <div className="flex flex-col gap-[26px] border-l border-surface-control pl-[22px]">
      {children}
    </div>
  )
}
```
