import type { Status } from "../design/index.ts"

/**
 * The one place the app's domain states map onto the design system's status
 * words (the closed set that drives StatusDot, Avatar, cards, and spines).
 * Colour is a status channel, so every screen reads status through here rather
 * than picking a hue itself.
 */

/**
 * A roster member's live presence → a status colour. Narrower than Status: an
 * agent is never `done`, so this is assignable to Avatar's status prop too.
 */
export function presenceStatus(activity: string): "working" | "attention" | "failed" | "idle" {
  switch (activity) {
    case "working":
    case "responding":
      return "working"
    case "needs_you":
      return "attention"
    case "failed":
      return "failed"
    default:
      return "idle"
  }
}

/** A job's lifecycle state → a status colour. */
export function jobStatus(state: string): Status {
  switch (state) {
    case "working":
    case "waiting_children":
      return "working"
    case "paused":
      return "attention"
    case "done":
      return "done"
    case "failed":
      return "failed"
    // assigned / cancelled are not live work.
    default:
      return "idle"
  }
}

/** A job's state as a short human label, e.g. "waiting children". */
export function jobStateLabel(state: string): string {
  return state.replace(/_/g, " ")
}

/** An attention item's kind → the two-tone variant KindChip/borders take. */
export function attentionTone(kind: string): "attention" | "failed" {
  return kind === "failure" ? "failed" : "attention"
}

/** A timeline node colour for a job state — the narrower set TimelineEntry takes. */
export function jobEntryState(state: string): "done" | "working" | "attention" | "failed" {
  const status = jobStatus(state)
  return status === "idle" || status === "confidential" ? "done" : status
}
