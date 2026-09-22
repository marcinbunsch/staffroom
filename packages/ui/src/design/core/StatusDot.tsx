/* Status is a dot, never a glyph and never a coloured label.
   Only `working` animates. */

export type Status = "failed" | "attention" | "working" | "done" | "idle" | "confidential"

export interface StatusDotProps {
  status?: Status
  /** 6–7px in lists, 9–10px on avatars and timeline nodes. */
  size?: number
  /** Expanding halo — only renders for status="working". */
  ring?: boolean
  /** Colour of the cut-out ring when the dot sits on an avatar. */
  ringColor?: string
}

const COLOR: Record<Status, string> = {
  failed: "bg-status-failed",
  attention: "bg-status-attention",
  working: "bg-status-working",
  done: "bg-status-done",
  idle: "bg-status-idle",
  confidential: "bg-status-confidential",
}
const RING: Record<Status, string> = {
  failed: "border-status-failed",
  attention: "border-status-attention",
  working: "border-status-working",
  done: "border-status-done",
  idle: "border-status-idle",
  confidential: "border-status-confidential",
}

export function StatusDot({ status = "idle", size = 7, ring = false, ringColor }: StatusDotProps) {
  const live = status === "working"
  const fill = COLOR[status] ?? COLOR.idle
  const stroke = RING[status] ?? RING.idle
  return (
    <span
      className="relative inline-block shrink-0"
      style={{ width: size, height: size, flexBasis: size }}
    >
      <span
        className={`absolute inset-0 rounded-full ${fill} ${live ? "animate-pulse-dot" : ""}`}
      />
      {ring && live ? (
        <span className={`absolute inset-0 rounded-full border ${stroke} animate-pulse-ring`} />
      ) : null}
      {ringColor ? (
        <span
          className="absolute -inset-0.5 rounded-full border-2"
          style={{ borderColor: ringColor }}
        />
      ) : null}
    </span>
  )
}
