# ArtifactRow

A file a job produced.

```jsx
<ArtifactRow type="MD" name="release-notes-v2.14.md" meta="draft · Scribe" metaTone="working" />
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

Reference implementation — `tailwind/components/patterns/ArtifactRow.jsx`:

```jsx
import React from "react"

/* Artifact types are three-letter mono badges: DIF, LOG, MD, TXT, PDF. */
export function ArtifactRow({ type, name, meta, metaTone = "faint", onClick }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-[11px] rounded-row border border-line-inset bg-surface-card-hover px-3 py-[11px] ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-monogram bg-surface-control font-mono text-[9px] text-ink-monogram">
        {type}
      </div>
      <div className="text-secondary">
        {name}
        <div
          className={`mt-0.5 font-mono text-mono ${metaTone === "working" ? "text-status-working" : "text-ink-faint"}`}
        >
          {meta}
        </div>
      </div>
    </div>
  )
}
```
