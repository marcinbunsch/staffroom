import { type FlueEvent, observe } from "@flue/runtime"
import { parseSessionKey, previewFromText } from "@staffroom/protocol"
import { getActivityTracker } from "./activity.ts"
import { getChatStore } from "./chats.ts"
import { getOperatorEvents } from "./operator-events.ts"
import { getUnreadStore } from "./unread.ts"

/**
 * Wire Flue's turn lifecycle to the live chat state: which chats are at work
 * (activity), which have unread replies, and when each last spoke (for history
 * ordering). A separate `observe()` from the audit tap — same event stream,
 * different concern — so neither obscures the other.
 *
 * Only a member's **chat** sessions count. Job sessions (`__job-`) and
 * agent-to-agent threads (`__a2-`) are not conversations the operator reads, so
 * they never touch a chat or a badge.
 */
export function startChatActivity(): () => void {
  return observe((event) => {
    try {
      handle(event)
    } catch (error) {
      // Presence and badges must never break the run that produces them.
      console.warn("[chat-activity] failed to handle a Flue event:", error)
    }
  })
}

function handle(event: FlueEvent): void {
  if (event.type !== "agent_start" && event.type !== "agent_end") return
  const session = event.instanceId
  if (!session) return
  const identity = parseSessionKey(session)
  if (!identity || identity.jobId !== undefined || identity.counterpart !== undefined) return

  if (event.type === "agent_start") {
    getActivityTracker().begin(identity.tenantId, identity.agentId, session)
    getOperatorEvents().publish({
      tenantId: identity.tenantId,
      event: { type: "agent.activity.changed", agent: identity.agentId },
    })
    return
  }

  // agent_end: the turn finished — the agent produced a reply.
  getActivityTracker().end(session)
  getOperatorEvents().publish({
    tenantId: identity.tenantId,
    event: { type: "agent.activity.changed", agent: identity.agentId },
  })
  const chat = getChatStore().bySession(session)
  if (!chat) return // a brand-new chat whose row is not created yet; nothing to update
  getChatStore().touch(session, new Date().toISOString(), replyPreview(event.messages))
  getUnreadStore().increment(identity.tenantId, chat.agent, session)
  getOperatorEvents().publish({
    tenantId: identity.tenantId,
    event: { type: "agent.unread.changed", agent: chat.agent },
  })
}

/**
 * The inbox preview of a finished turn: the text of its last assistant message
 * that said anything. Null for a turn of only tool calls, which keeps the
 * previous preview.
 */
export function replyPreview(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: unknown; content?: unknown }
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue
    const text = message.content
      .filter((part): part is { type: "text"; text: string } => {
        const candidate = part as { type?: unknown; text?: unknown }
        return candidate?.type === "text" && typeof candidate.text === "string"
      })
      .map((part) => part.text)
      .join("\n")
    const preview = previewFromText(text)
    if (preview) return preview
  }
  return null
}
