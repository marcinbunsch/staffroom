import { z } from "zod"

/**
 * The operator event stream's payloads — the content-free "this slice changed"
 * signals the server pushes over `/api/operator/stream` and the UI's data layer
 * reacts to. Defined here so the server's publisher and the client's parser
 * share one schema; the client validates each SSE frame against it rather than
 * trusting the wire.
 */
export const OperatorEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent.activity.changed"), agent: z.string() }),
  z.object({ type: z.literal("agent.unread.changed"), agent: z.string() }),
  // An agent created, updated, or removed one of its widgets. Carries the agent
  // so a single board can ignore other agents' widgets; a dashboard, which mixes
  // widgets from many agents, reacts to any of them.
  z.object({ type: z.literal("widget.changed"), agent: z.string() }),
  z.object({ type: z.literal("attention.changed") }),
  z.object({ type: z.literal("job.state.changed") }),
  z.object({ type: z.literal("schedule.changed") }),
])

export type OperatorEvent = z.infer<typeof OperatorEvent>
