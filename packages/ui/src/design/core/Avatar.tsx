import { StatusDot } from "./StatusDot.tsx"

/* Agents are two-letter monograms. There is no photography in this product. */

export interface AvatarProps {
  /** Two-letter agent monogram, e.g. "ST". Never an image. */
  initials: string
  /** sm 24 (rails) · md 26 (cards) · lg 34 (headers, roster). */
  size?: "sm" | "md" | "lg"
  /** Adds a corner status dot. Omit for idle agents. */
  status?: "failed" | "attention" | "working" | "done"
  /** Idle agents drop to the subtle surface and muted ink. */
  idle?: boolean
  /** Surface the avatar sits on, so the status dot can cut out cleanly. */
  ringColor?: string
}

const BOX: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "w-6 h-6 basis-6 text-label rounded-monogram",
  md: "w-[26px] h-[26px] basis-[26px] text-label rounded-monogram",
  lg: "w-[34px] h-[34px] basis-[34px] text-mono rounded-[9px]",
}

export function Avatar({
  initials,
  size = "md",
  status,
  idle = false,
  ringColor = "var(--surface-panel)",
}: AvatarProps) {
  return (
    <div
      className={`relative grid shrink-0 place-items-center font-mono ${BOX[size] ?? BOX.md} ${
        idle ? "bg-line-subtle text-ink-faint" : "bg-surface-control text-ink-monogram"
      }`}
    >
      {initials}
      {status ? (
        <span
          className="absolute -right-[3px] -bottom-[3px] grid h-2.5 w-2.5 place-items-center rounded-full border-2 bg-transparent"
          style={{ borderColor: ringColor }}
        >
          <StatusDot status={status} size={6} />
        </span>
      ) : null}
    </div>
  )
}
