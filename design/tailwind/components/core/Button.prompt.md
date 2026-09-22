# Button

The button set. Amber `approve` means "this unblocks an agent"; `danger` is outline-only for stop/destroy.

```jsx
<Button variant="approve">Approve rollout</Button>
<Button variant="secondary">Review</Button>
<Button variant="danger">Stop</Button>
```

Labels are verbs with an object when ambiguous ("Retry 8 sources"), never "OK" or "Confirm".

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

Reference implementation — `tailwind/components/core/Button.jsx`:

```jsx
import React from "react"

/* Buttons are verbs. One amber `approve` per screen at most — it is the
   only saturated fill in the system. Nothing transforms on press. */
const VARIANTS = {
  approve:
    "bg-status-attention-fill text-status-attention-ink border-transparent font-semibold hover:bg-status-attention-hover px-[15px]",
  primary:
    "bg-surface-control-hover text-ink-primary border-line-control font-medium hover:bg-surface-control-active px-[15px]",
  secondary:
    "bg-transparent text-ink-secondary border-line-strong hover:bg-surface-selected px-[13px]",
  ghost: "bg-transparent text-ink-muted border-transparent hover:text-ink-primary px-[13px]",
  danger:
    "bg-tint-failed text-status-failed-ink border-line-danger font-medium hover:bg-tint-failed-hover px-[13px]",
}

export function Button({
  children,
  variant = "secondary",
  disabled = false,
  onClick,
  className = "",
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`rounded-control border py-2 font-sans text-secondary transition-[background-color,color,border-color] duration-[120ms] ease-out ${
        VARIANTS[variant] || VARIANTS.secondary
      } ${disabled ? "cursor-default opacity-55 text-ink-meta hover:bg-transparent" : "cursor-pointer"} ${className}`}
    >
      {children}
    </button>
  )
}
```
