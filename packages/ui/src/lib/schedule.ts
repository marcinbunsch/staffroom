import type { Timing } from "./api.ts"

/** A one-line, human reading of when a schedule fires. */
export function describeSchedule(timing: Timing): string {
  if (timing.kind === "cron") return timing.expression
  if (timing.kind === "once") {
    return `once on ${new Date(timing.at).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    })}`
  }
  const { seconds } = timing
  if (seconds % 3600 === 0) return `every ${seconds / 3600} h`
  if (seconds % 60 === 0) return `every ${seconds / 60} min`
  return `every ${seconds}s`
}
