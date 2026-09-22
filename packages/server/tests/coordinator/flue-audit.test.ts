import type { FlueEvent } from "@flue/runtime"
import { afterEach, describe, expect, it } from "vitest"
import {
  pendingToolArgumentCount,
  rememberToolArguments,
  resetPendingToolArguments,
  toAuditEvent,
} from "../../src/coordinator/flue-audit.ts"

afterEach(() => resetPendingToolArguments())

// Flue's event union is wide and mostly irrelevant here; each case builds the
// few fields the mapping actually reads.
function event(shape: Record<string, unknown>): FlueEvent {
  return shape as unknown as FlueEvent
}

const SESSION = "alice:devops"
const JOB_SESSION = "alice:devops__job-42"

describe("mapping Flue events to audit rows", () => {
  /**
   * Attribution is by `instanceId` — the session key the caller chose — and
   * never by `conversationId`, which is Flue's own generated id and belongs to
   * no tenant. Getting this backwards was one of the prototype's hard-won
   * lessons, so it gets a test rather than a comment.
   */
  it("takes the tenant from the session key, not from Flue's conversation id", () => {
    const mapped = toAuditEvent(
      event({ type: "agent_start", instanceId: SESSION, conversationId: "conv_01ABCDEF" }),
    )

    expect(mapped?.tenantId).toBe("alice")
    expect(mapped?.agent).toBe("devops")
    expect(mapped?.session).toBe(SESSION)
  })

  it("carries the job id from a job session", () => {
    const mapped = toAuditEvent(event({ type: "agent_start", instanceId: JOB_SESSION }))

    expect(mapped?.jobId).toBe(42)
    expect(mapped?.tenantId).toBe("alice")
  })

  it("drops an event it cannot attribute to a tenant", () => {
    expect(toAuditEvent(event({ type: "agent_start" }))).toBeUndefined()
    expect(toAuditEvent(event({ type: "agent_start", instanceId: "nonsense" }))).toBeUndefined()
  })

  it("ignores the noise: deltas, fragments, requests", () => {
    for (const type of ["turn_request", "message_delta", "tool_start"]) {
      expect(toAuditEvent(event({ type, instanceId: SESSION })), type).toBeUndefined()
    }
  })

  describe("a model turn", () => {
    const turn = event({
      type: "turn",
      instanceId: SESSION,
      durationMs: 1200,
      isError: false,
      request: { providerId: "anthropic-abc123", requestedModel: "claude-sonnet-5" },
      response: {
        responseModel: "claude-sonnet-5-20260101",
        finishReason: "stop",
        usage: {
          input: 293,
          output: 5,
          cacheRead: 10,
          cacheWrite: 2,
          cost: { total: 0.001615 },
        },
      },
    })

    /**
     * Flue prices each turn against the model's own cost table, so the number
     * is read rather than computed — there is no local price list here to go
     * stale.
     */
    it("lifts Flue's own pricing into columns", () => {
      const mapped = toAuditEvent(turn)

      expect(mapped?.type).toBe("model.turn")
      expect(mapped?.usage).toEqual({
        model: "claude-sonnet-5-20260101",
        credentialId: "anthropic-abc123",
        tokensIn: 293,
        tokensOut: 5,
        cacheRead: 10,
        cacheWrite: 2,
        costTotal: 0.001615,
      })
    })

    it("records zero rather than nothing when a turn reports no usage", () => {
      const mapped = toAuditEvent(
        event({ ...turn, response: { finishReason: "stop" }, request: { providerId: "p" } }),
      )

      expect(mapped?.usage.costTotal).toBe(0)
      expect(mapped?.usage.tokensIn).toBe(0)
    })

    it("keeps what is not worth a column in the payload", () => {
      expect(toAuditEvent(turn)?.payload).toMatchObject({
        provider: "anthropic-abc123",
        durationMs: 1200,
        finishReason: "stop",
      })
    })
  })

  describe("a tool call", () => {
    /**
     * Flue emits the arguments with `tool_start` and the result with `tool`, so
     * a row carrying both has to hold the arguments in between. Without this
     * the prototype logged the output of every shell command and never the
     * command itself.
     */
    it("pairs the arguments from tool_start with the result", () => {
      rememberToolArguments(
        event({ type: "tool_start", toolCallId: "call_1", args: { path: "/etc/hosts" } }),
      )
      const mapped = toAuditEvent(
        event({
          type: "tool",
          instanceId: SESSION,
          toolCallId: "call_1",
          toolName: "read_file",
          durationMs: 4,
          isError: false,
          result: { details: { output: "127.0.0.1 localhost" } },
        }),
      )

      expect(mapped?.payload).toMatchObject({
        tool: "read_file",
        input: '{"path":"/etc/hosts"}',
        result: "127.0.0.1 localhost",
      })
    })

    it("releases held arguments once the call completes", () => {
      rememberToolArguments(event({ type: "tool_start", toolCallId: "call_1", args: { a: 1 } }))
      expect(pendingToolArgumentCount()).toBe(1)

      toAuditEvent(event({ type: "tool", instanceId: SESSION, toolCallId: "call_1", result: "ok" }))
      expect(pendingToolArgumentCount()).toBe(0)
    })

    it("records a call whose arguments were never seen", () => {
      const mapped = toAuditEvent(
        event({ type: "tool", instanceId: SESSION, toolCallId: "orphan", result: "ok" }),
      )
      expect(mapped?.payload.input).toBeNull()
    })

    it("prefers the tool's own output over Flue's envelope", () => {
      const mapped = toAuditEvent(
        event({
          type: "tool",
          instanceId: SESSION,
          toolCallId: "c",
          result: { content: [{ type: "text" }], details: { output: "the real answer" } },
        }),
      )
      expect(mapped?.payload.result).toBe("the real answer")
    })

    it("costs nothing — only model turns are priced", () => {
      const mapped = toAuditEvent(
        event({ type: "tool", instanceId: SESSION, toolCallId: "c", result: "ok" }),
      )
      expect(mapped?.usage.costTotal).toBe(0)
    })
  })
})
