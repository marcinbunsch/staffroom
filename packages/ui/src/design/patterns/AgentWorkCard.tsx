import type { ReactNode } from "react"
import { Avatar } from "../core/Avatar.tsx"
import { StatusDot } from "../core/StatusDot.tsx"
import { ProgressBar } from "../core/ProgressBar.tsx"

/* Live work. Cards raise their border on hover — they never lift or scale. */

export interface AgentWorkCardProps {
  name: string
  initials: string
  status?: "working" | "attention" | "failed" | "idle"
  /** Plain-language current work label. */
  work: ReactNode
  progress?: number | null
  /** Mono footer, left: step or counts. */
  left?: ReactNode
  /** Mono footer, right: elapsed time. */
  right?: ReactNode
  onClick?: () => void
}

export function AgentWorkCard({
  name,
  initials,
  status = "working",
  work,
  progress = null,
  left,
  right,
  onClick,
}: AgentWorkCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-card border border-line-default bg-surface-card p-[18px] transition-colors duration-[120ms] ease-out ${
        onClick ? "cursor-pointer hover:border-line-accent" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <Avatar initials={initials} size="md" />
        <div className="font-semibold">{name}</div>
        <div className="ml-auto">
          <StatusDot status={status} />
        </div>
      </div>
      <div className="mt-3.5 text-secondary text-ink-body">{work}</div>
      <div className="mt-2.5">
        <ProgressBar value={progress} />
      </div>
      <div className="mt-3 flex justify-between font-mono text-mono text-ink-faint">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  )
}
