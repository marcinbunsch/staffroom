import { observe } from "@flue/runtime"
import type { FlueEvent } from "@flue/runtime"
import { type AuditEventInput, NO_USAGE, parseSessionKey } from "@staffroom/protocol"
import { type AuditLog, getAuditLog } from "./audit.ts"

/**
 * Central instrumentation: one `observe()` subscriber taps every agent turn and
 * tool call and records it.
 *
 * This is the "wrap once, centrally" boundary — Flue's own event stream rather
 * than a wrapper around each tool. A per-tool wrapper is a thing you can forget
 * to add; a subscriber is not.
 *
 * Attribution is by `instanceId`, which is the caller-chosen session key
 * (`alice:devops`, `alice:devops__job-42`) and therefore carries the tenant.
 * `conversationId` is Flue's internal id and means nothing to us — getting this
 * backwards was one of the prototype's hard-won lessons.
 */
export function startFlueAudit(log: AuditLog = getAuditLog()): () => void {
  return observe((event) => {
    try {
      rememberToolArguments(event)
      const input = toAuditEvent(event)
      if (input) log.record(input)
    } catch (error) {
      // Auditing must never break the run it observes.
      console.warn("[audit] failed to record a Flue event:", error)
    }
  })
}

/**
 * Map the handful of lifecycle events worth keeping; ignore the rest (streaming
 * deltas, message fragments, model requests). Returns undefined to skip.
 *
 * Exported for tests: it is the whole mapping, and pairing a tool's arguments
 * with its result is the part worth proving.
 */
export function toAuditEvent(event: FlueEvent): AuditEventInput | undefined {
  // No session key means nothing to attribute it to. A row with no tenant would
  // be invisible to every tenant-scoped read anyway, so dropping it is honest.
  const identity = event.instanceId ? parseSessionKey(event.instanceId) : undefined
  if (!identity) return undefined

  const base = {
    tenantId: identity.tenantId,
    actor: { kind: "agent", id: identity.agentId } as const,
    agent: identity.agentId,
    session: event.instanceId ?? null,
    jobId: identity.jobId ?? null,
  }

  switch (event.type) {
    case "agent_start":
      return { ...base, type: "agent.start", usage: NO_USAGE, payload: {} }

    case "agent_end":
      return {
        ...base,
        type: "agent.end",
        usage: NO_USAGE,
        payload: { messages: event.messages.length },
      }

    case "tool":
      return {
        ...base,
        type: "tool.call",
        usage: NO_USAGE,
        payload: {
          tool: event.toolName,
          toolCallId: event.toolCallId,
          durationMs: event.durationMs,
          isError: event.isError,
          input: takeToolArguments(event.toolCallId),
          result: toolResultText(event.result),
        },
      }

    case "turn": {
      // Flue prices every turn against the model's own cost table, so the
      // number is read rather than computed here — no local price list to go
      // stale. The credential that paid rides in the response metadata, put
      // there by the agent's `useResponseFinish`.
      const usage = event.response.usage
      return {
        ...base,
        type: "model.turn",
        usage: {
          model: event.response.responseModel ?? event.request.requestedModel ?? null,
          credentialId: creditedCredential(event),
          tokensIn: usage?.input ?? 0,
          tokensOut: usage?.output ?? 0,
          cacheRead: usage?.cacheRead ?? 0,
          cacheWrite: usage?.cacheWrite ?? 0,
          costTotal: usage?.cost?.total ?? 0,
        },
        payload: {
          provider: event.request.providerId,
          durationMs: event.durationMs,
          finishReason: event.response.finishReason ?? null,
          isError: event.isError,
        },
      }
    }

    default:
      return undefined
  }
}

function creditedCredential(event: Extract<FlueEvent, { type: "turn" }>): string | null {
  const providerId = event.request.providerId
  // The provider id *is* the credential (see providers/registry.ts): the
  // suffix after the upstream name identifies which key paid.
  return typeof providerId === "string" ? providerId : null
}

// A custom tool's result arrives as Flue's envelope ({ content, details }); the
// plain string the tool returned lives at details.output. Prefer that, so the
// log shows what the tool said rather than the wrapper.
function toolResultText(result: unknown): string {
  if (result !== null && typeof result === "object" && "details" in result) {
    const details = result.details
    if (details !== null && typeof details === "object" && "output" in details) {
      if (typeof details.output === "string") return short(details.output)
    }
  }
  return short(result)
}

/**
 * What a tool was asked to do, held between the two events that describe one
 * call.
 *
 * Flue emits the arguments with `tool_start` and the result with `tool`, so a
 * single audit row carrying both has to keep the arguments in between. Without
 * this the log recorded the output of every shell command an agent ran and
 * never the command itself.
 */
const pendingToolArguments = new Map<string, string>()

// A tool that never reaches its terminal event would otherwise hold its
// arguments forever. Far above any real number of calls in flight.
const MAX_PENDING_TOOL_ARGUMENTS = 256

// Longer than a result summary: a shell command is the point of the record, and
// truncating one to 300 characters loses the end of the pipeline.
const MAX_TOOL_INPUT = 600

/** Exported for tests; the subscriber calls this before {@link toAuditEvent}. */
export function rememberToolArguments(event: FlueEvent): void {
  if (event.type !== "tool_start" || event.args === undefined) return

  if (pendingToolArguments.size >= MAX_PENDING_TOOL_ARGUMENTS) {
    const oldest = pendingToolArguments.keys().next()
    if (!oldest.done) pendingToolArguments.delete(oldest.value)
  }
  pendingToolArguments.set(event.toolCallId, short(event.args, MAX_TOOL_INPUT))
}

function takeToolArguments(toolCallId: string): string | null {
  const args = pendingToolArguments.get(toolCallId) ?? null
  pendingToolArguments.delete(toolCallId)
  return args
}

/** Exposed for tests: nothing should be held once every call has completed. */
export function pendingToolArgumentCount(): number {
  return pendingToolArguments.size
}

/** Exposed for tests, so one case cannot leak arguments into the next. */
export function resetPendingToolArguments(): void {
  pendingToolArguments.clear()
}

// Compact a value for the log: one line, bounded length. Keeps the log lean —
// large payloads become files later, not log rows.
function short(value: unknown, max = 300): string {
  let text: string
  try {
    text = typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (!text) return ""
  text = text.replace(/\s+/g, " ")
  return text.length > max ? `${text.slice(0, max)}…` : text
}
