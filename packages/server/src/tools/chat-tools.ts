import { defineTool, useTool } from "@flue/runtime"
import { CHAT_TITLE_MAX } from "@staffroom/protocol"
import * as v from "valibot"
import { type ChatStore, getChatStore } from "../coordinator/chats.ts"
import { getOperatorEvents } from "../coordinator/operator-events.ts"

/**
 * The caller's identity, captured at render time. Flue does not tell a tool
 * which agent invoked it, so StaffAgent binds it in here — the same thing
 * attachMemoryTools and attachScheduleTools do. The `session` is the Flue
 * conversation id, which maps one-to-one to a chat row (`ChatStore.bySession`),
 * so the tool always acts on the chat the agent is currently in.
 */
export interface ChatToolContext {
  tenantId: string
  agent: string
  session: string
}

/**
 * Let an agent name the chat it's in. A fresh side chat starts as "New chat", so
 * once the conversation has a clear topic the agent can title it — and a titled
 * chat is what the operator finds and switches to in the command palette. Only
 * attached to chat sessions; a job session has no chat to rename.
 */
export function attachChatTools(context: ChatToolContext): void {
  useTool(makeRenameChat(context))
}

function makeRenameChat(context: ChatToolContext) {
  return defineTool({
    name: "rename_chat",
    description:
      "Rename the chat you're in to a short title that captures what it's about. Do this once the conversation's topic is clear — a fresh chat starts as \"New chat\", and a good title is how the operator finds and switches to this conversation later (it shows on the chat's tab and in search). Keep it to a few words; renaming again replaces the title.",
    input: v.object({
      title: v.pipe(
        v.string(),
        v.minLength(1, "Give the chat a non-empty title."),
        v.maxLength(CHAT_TITLE_MAX, `Keep the title to ${CHAT_TITLE_MAX} characters or fewer.`),
      ),
    }),
    run: async ({ data }) => {
      const result = renameCurrentChat(getChatStore(), context, data.title)
      // Nudge the operator's open tab strip (if any) to reload and show the new
      // title. There is no dedicated "chat renamed" event; an activity change is
      // what the client already reacts to by refetching a loaded agent's strip.
      if (result.renamedAgent) {
        getOperatorEvents().publish({
          tenantId: context.tenantId,
          event: { type: "agent.activity.changed", agent: result.renamedAgent },
        })
      }
      return result.message
    },
  })
}

export interface RenameResult {
  /** What the agent is told. */
  message: string
  /** The agent whose strip changed, present only on a successful rename. */
  renamedAgent?: string
}

/**
 * The logic behind rename_chat, separated from the tool so it can be tested
 * without a Flue render frame or the operator-event singleton. Resolves the
 * current session to its chat and renames it, tenant-scoped.
 */
export function renameCurrentChat(
  store: ChatStore,
  context: ChatToolContext,
  rawTitle: string,
): RenameResult {
  const title = rawTitle.trim()
  if (!title) return { message: "Give the chat a non-empty title." }
  const chat = store.bySession(context.session)
  if (!chat || chat.tenantId !== context.tenantId) {
    return { message: "There's no chat to rename here — this session isn't a chat." }
  }
  const renamed = store.rename(context.tenantId, chat.id, title)
  if (!renamed) return { message: "Could not rename this chat." }
  return { message: `Renamed this chat to "${renamed.title}".`, renamedAgent: chat.agent }
}
