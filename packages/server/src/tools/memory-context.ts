import { useAgentStart, useDelivery } from "@flue/runtime"
import { getAgentMemoryStore } from "../coordinator/memory.ts"

export const MEMORY_CONTEXT_SIGNAL = "memory-context"

export interface MemoryContextHookContext {
  tenantId: string
  agent: string
}

/**
 * Adds a retrieved archive briefing immediately after the delivery it answers.
 * The signal is durable history: later retries replay the exact old briefing
 * instead of re-querying memory and invalidating an otherwise cached prefix.
 */
export function attachMemoryContext(context: MemoryContextHookContext): void {
  const delivery = useDelivery()
  const memory = getAgentMemoryStore()
  useAgentStart(({ append }) => {
    if (delivery.kind !== "user" && !(delivery.kind === "signal" && delivery.type === "job")) return
    const briefing = memory.contextFor(
      context.tenantId,
      context.agent,
      delivery.body.slice(0, 4_000),
    )
    if (!briefing) return
    append({
      kind: "signal",
      type: MEMORY_CONTEXT_SIGNAL,
      tagName: MEMORY_CONTEXT_SIGNAL,
      attributes: { refs: briefing.refs },
      body: briefing.body,
    })
  })
}
