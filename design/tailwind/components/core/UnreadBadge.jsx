import React from "react"

/* Amber, because an unread message is something waiting on you. */
export function UnreadBadge({ count }) {
  if (!count) return null
  return (
    <span className="grid h-[17px] min-w-[17px] place-items-center rounded-[9px] bg-status-attention-fill px-[5px] font-sans text-label font-semibold text-status-attention-ink">
      {count}
    </span>
  )
}
