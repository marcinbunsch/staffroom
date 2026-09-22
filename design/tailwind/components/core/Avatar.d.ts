import * as React from "react"

/**
 * @startingPoint section="Identity" subtitle="Staff Avatar" viewport="700x220"
 */
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
