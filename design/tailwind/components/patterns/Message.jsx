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
