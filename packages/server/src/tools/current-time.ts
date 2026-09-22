import { defineTool, useTool } from "@flue/runtime"
import * as v from "valibot"

/**
 * The clock — a built-in, always attached to every agent. Needs no credential
 * and is never gated: checking the time is like writing a note to self, and it
 * is common enough that it should not cost a grant or a compact-gateway hop.
 */
export function attachCurrentTimeTool(): void {
  useTool(
    defineTool({
      name: "current_time",
      description: "Get the current date and time (ISO 8601, UTC).",
      input: v.object({}),
      run: async () => new Date().toISOString(),
    }),
  )
}
