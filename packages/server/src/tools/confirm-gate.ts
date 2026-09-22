import type { AttentionStore } from "../coordinator/attention.ts"
import { getAttentionStore, hashArguments } from "../coordinator/attention.ts"
import type { AttachTool, ToolContext, ToolDescriptor } from "./registry.ts"

/**
 * The confirm-gate, as a wrapping `AttachTool`.
 *
 * A gated tool's descriptor is not mounted directly; its Flue tool is replaced
 * by one whose `run` first looks for a matching one-shot approval. Because it
 * wraps the mounted tool rather than the implementation, local tools, MCP
 * tools and plugin tools would all gate identically, and the tool itself knows
 * nothing about gating.
 *
 * The flow, and why it suspends rather than blocks:
 *
 *  1. The agent calls a gated tool. The wrapper finds no approval, raises one
 *     plus an attention item, and **returns immediately** — "this needs
 *     approval". The turn ends cleanly and the submission settles; no lease is
 *     held, nothing burns tokens waiting.
 *  2. The operator answers. The answer dispatches a *new turn* into the same
 *     session ("approved — proceed"), so the model sees its own earlier attempt
 *     and re-issues the call.
 *  3. The re-issued call finds the approval, consumes it (one-shot, bound to
 *     this exact call), and calls through. A second identical call without a
 *     fresh approval is gated again — so an approval cannot approve forever.
 *
 * A blocking gate would instead trip Flue's one-hour submission timeout, be
 * reclaimed and retried up to ten times. This is the only shape that survives
 * an overnight wait.
 */
export function gatingAttach(
  attention: AttentionStore = getAttentionStore(),
  mount: (tool: unknown) => void = () => {},
): AttachTool {
  return (descriptor, context, tool) => {
    if (!descriptor.gated) {
      mount(tool)
      return
    }
    mount(wrapGated(descriptor, context, tool, attention))
  }
}

/**
 * The wrapped tool. It reuses the original tool object — keeping its already
 * validated name, description and input schema — and swaps only `run`, so the
 * model calls it identically and Flue never re-validates a compiled schema.
 */
function wrapGated(
  descriptor: ToolDescriptor,
  context: ToolContext,
  tool: unknown,
  attention: AttentionStore,
): unknown {
  const original = tool as {
    name: string
    run: (arg: { data: unknown }) => Promise<string> | string
  }
  const originalRun = original.run.bind(original)

  const gatedRun = (arg: { data: unknown }): Promise<string> =>
    invokeGated(descriptor.gated, context, original.name, arg.data, originalRun, attention)

  // Same object, one field replaced — Flue sees a valid tool it already checked.
  return Object.assign(Object.create(Object.getPrototypeOf(original)), original, { run: gatedRun })
}

/**
 * The gate itself, as one call around a tool's `run`. It is the single source
 * of the confirm-gate flow — used by the wrapping attach (which mounts each
 * tool directly) and by the compact `call_tool` (which dispatches many tools
 * through one meta-tool). Both must gate identically, so both come through here.
 *
 * When `gated` is false it just calls through, so a caller can hand every tool
 * to this function and let it decide.
 */
export async function invokeGated(
  gated: boolean,
  // Only the identity fields are read (session/tenant/agent/job), so a compact
  // MCP call — which has no resolved credential — can gate through here too.
  context: Omit<ToolContext, "credential">,
  toolName: string,
  data: unknown,
  run: (arg: { data: unknown }) => Promise<string> | string,
  attention: AttentionStore = getAttentionStore(),
): Promise<string> {
  if (!gated) return await run({ data })

  const argumentsHash = hashArguments(data)

  // Approved already? Consume it (one-shot) and call through.
  if (attention.consumeApproval(context.session, toolName, argumentsHash)) {
    return await run({ data })
  }

  // A pending request already exists (the operator has not answered yet) — do
  // not raise a duplicate; just restate that it is waiting.
  if (attention.pendingFor(context.session, toolName, argumentsHash)) {
    return `Still awaiting operator approval to run ${toolName}. The turn will resume when they answer.`
  }

  // Raise the gate and end the turn cleanly. No lease is held.
  attention.raise({
    tenantId: context.tenantId,
    jobId: context.jobId ?? null,
    session: context.session,
    agent: context.agent,
    tool: toolName,
    argumentsHash,
    summary: summarize(toolName, data),
  })
  return `This action needs operator approval and has been sent for review: ${summarize(toolName, data)}. Stop here; you will be asked to proceed once it is approved.`
}

function summarize(tool: string, data: unknown): string {
  const rendered = (() => {
    try {
      return JSON.stringify(data)
    } catch {
      return String(data)
    }
  })()
  return `${tool}(${rendered.length > 200 ? `${rendered.slice(0, 200)}…` : rendered})`
}
