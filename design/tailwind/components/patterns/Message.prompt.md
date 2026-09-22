# Message

A turn in an agent's durable thread. Agent replies are unstyled text so long output stays readable.

Timestamps are small mono `text-label text-ink-disabled` `<time>` labels — under the bubble for the operator, above the first block for an agent. HH:MM only; the day is carried by the thread's date divider.

```jsx
<Message from="operator" time="09:02" datetime="2026-08-30T09:02">Put together a brief for Marta's 1:1.</Message>
<Message from="agent" initials="ST" time="09:02" datetime="2026-08-30T09:02">Starting now. I'll pull from four places.</Message>
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

Reference implementation — `tailwind/components/patterns/Message.jsx`:

```jsx
import React from "react"
import { Avatar } from "../core/Avatar.jsx"

/* The operator's bubble is the only asymmetric radius in the system.
   Agent turns are unbubbled — they are output, not chat.
   `time` is a short wall-clock label (HH:MM); `datetime` is the machine value. */
export function Message({ from = "agent", initials, time, datetime, children }) {
  const stamp = time ? (
    <time
      dateTime={datetime}
      className={"font-mono text-label text-ink-disabled" + (from === "operator" ? " px-1" : "")}
    >
      {time}
    </time>
  ) : null

  if (from === "operator") {
    return (
      <div className="flex max-w-[560px] flex-col items-end gap-1.5 self-end">
        <div className="rounded-[14px_14px_4px_14px] bg-surface-control px-[17px] py-[13px] text-body text-ink-primary">
          {children}
        </div>
        {stamp}
      </div>
    )
  }
  return (
    <div className="flex gap-3.5">
      <Avatar initials={initials} size="md" />
      <div className="flex min-w-0 max-w-[620px] flex-col gap-3.5 text-body text-ink-body text-pretty">
        {stamp}
        {children}
      </div>
    </div>
  )
}
```
