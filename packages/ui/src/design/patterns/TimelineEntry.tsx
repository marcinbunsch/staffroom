import type { ReactNode } from "react"

/* Job history. Node colour is the state; only the title of an attention
   entry takes colour, never the body. */

export interface TimelineEntryProps {
  title: ReactNode
  /** Mono clock time, e.g. "13:24". */
  time: ReactNode
  /** Node colour = state of that step. */
  state?: "done" | "working" | "attention" | "failed"
  /** Optional detail block: mono tool output, handoff card, artifact. */
  children?: ReactNode
  /** Surface behind the node, for the cut-out ring. */
  ringColor?: string
}

const NODE: Record<NonNullable<TimelineEntryProps["state"]>, string> = {
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
}: TimelineEntryProps) {
  return (
    <div className="relative">
      <div
        className={`absolute -left-[27px] top-[5px] h-[9px] w-[9px] rounded-full border-2 ${
          NODE[state] ?? NODE.done
        }`}
        style={{ borderColor: ringColor }}
      />
      <div className="flex items-baseline gap-3">
        <div
          className={`text-secondary font-semibold ${
            state === "attention" ? "text-status-attention" : "text-ink-primary"
          }`}
        >
          {title}
        </div>
        <div className="font-mono text-mono text-ink-label">{time}</div>
      </div>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}

export interface TimelineProps {
  children?: ReactNode
}

export function Timeline({ children }: TimelineProps) {
  return (
    <div className="flex flex-col gap-[26px] border-l border-surface-control pl-[22px]">
      {children}
    </div>
  )
}
