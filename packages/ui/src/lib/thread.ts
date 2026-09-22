import type { FlueConversationMessage } from "@flue/react"

/**
 * When a message was said.
 *
 * Flue stamps nothing, so an agent turn carries the `startedAt` our own
 * useResponseStart hook attaches. An operator message has no stamp of its own —
 * nothing on the send path records one — so it borrows the start of the reply
 * it produced, which follows within a second of the send. A message with no
 * reply yet, and every message from before the hook existed, simply has no
 * time rather than a made-up one.
 */
export function messageTime(
  messages: readonly FlueConversationMessage[],
  index: number,
): string | undefined {
  const message = messages[index]
  if (!message) return undefined
  if (message.role !== "user") return startedAt(message)

  for (let next = index + 1; next < messages.length; next++) {
    const candidate = messages[next]
    if (candidate?.role === "user") break
    const stamped = startedAt(candidate)
    if (stamped) return stamped
  }
  return undefined
}

function startedAt(message: FlueConversationMessage | undefined): string | undefined {
  const value = message?.metadata?.startedAt
  return typeof value === "string" ? value : undefined
}
