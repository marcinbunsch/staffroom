import React from "react"

/* Uppercase mono kind label: DECISION, FAILED, QUESTION, HANDOFF. */
const TONES = {
  attention: "bg-tint-attention text-status-attention border-transparent",
  failed: "bg-tint-failed text-status-failed border-transparent",
  neutral: "bg-line-subtle text-ink-muted border-line-strong",
}

export function KindChip({ children, tone = "neutral" }) {
  return (
    <span
      className={`rounded-[5px] border px-[7px] py-[3px] font-mono text-label tracking-[0.6px] whitespace-nowrap ${
        TONES[tone] || TONES.neutral
      }`}
    >
      {children}
    </span>
  )
}
