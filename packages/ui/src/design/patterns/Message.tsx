import type { ReactNode } from "react"
import { Avatar } from "../core/Avatar.tsx"

/* The operator's bubble is the only asymmetric radius in the system.
   Agent turns are unbubbled — they are output, not chat. */

export interface MessageProps {
  /** operator = filled bubble, right-aligned; agent = plain text with avatar gutter. */
  from?: "operator" | "agent"
  initials?: string
  /**
   * ISO moment the message was said, shown under an operator bubble. An agent
   * turn carries its time in the usage line at its foot instead, next to what
   * the turn cost.
   */
  time?: string
  children?: ReactNode
}

export function Message({ from = "agent", initials, time, children }: MessageProps) {
  if (from === "operator") {
    return (
      <div className="flex max-w-[min(560px,88%)] flex-col items-end gap-1.5 self-end">
        <div className="whitespace-pre-wrap [overflow-wrap:break-word] rounded-[14px_14px_4px_14px] bg-surface-control px-[17px] py-[13px] text-body text-ink-primary">
          {children}
        </div>
        {time && <Timestamp at={time} className="px-1" />}
      </div>
    )
  }
  return (
    <div className="flex gap-3.5">
      <Avatar initials={initials ?? ""} size="md" />
      <div className="flex min-w-0 max-w-[620px] flex-col gap-3.5 text-body text-ink-body text-pretty">
        {children}
      </div>
    </div>
  )
}

/** Clock time, with the full moment in the title for anything older than today. */
function Timestamp({ at, className = "" }: { at: string; className?: string }) {
  const moment = new Date(at)
  if (Number.isNaN(moment.getTime())) return null
  return (
    <time
      dateTime={at}
      title={moment.toLocaleString()}
      className={`font-mono text-label text-ink-disabled ${className}`}
    >
      {moment.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  )
}
