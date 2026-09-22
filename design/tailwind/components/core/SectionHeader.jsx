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
