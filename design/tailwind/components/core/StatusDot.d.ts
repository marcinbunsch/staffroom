import * as React from "react"

/**
 * @startingPoint section="Status" subtitle="Staff StatusDot" viewport="700x220"
 */
export interface StatusDotProps {
  /** Priority order when several apply: failed > attention > working > idle. */
  status?: "failed" | "attention" | "working" | "done" | "idle" | "confidential"
  /** 6–7px in lists, 9–10px on avatars and timeline nodes. */
  size?: number
  /** Expanding halo — only renders for status="working". */
  ring?: boolean
  /** Colour of the cut-out ring when the dot sits on an avatar. */
  ringColor?: string
}
