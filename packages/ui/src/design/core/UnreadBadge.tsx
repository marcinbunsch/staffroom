/* Amber, because an unread message is something waiting on you. */

export interface UnreadBadgeProps {
  /** Renders nothing when 0 or undefined. */
  count?: number
}

export function UnreadBadge({ count }: UnreadBadgeProps) {
  if (!count) return null
  return (
    <span className="grid h-[17px] min-w-[17px] place-items-center rounded-[9px] bg-status-attention-fill px-[5px] font-sans text-label font-semibold text-status-attention-ink">
      {count}
    </span>
  )
}
