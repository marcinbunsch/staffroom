import { defineTool, useTool } from "@flue/runtime"
import * as v from "valibot"
import { getAttentionStore } from "../coordinator/attention.ts"

/**
 * Escalate to the operator and stop — the `attention_request` tool.
 *
 * The counterpart to `ask_agent`: that asks another agent and blocks, because a
 * peer answers within the turn. A human does not — an answer can be minutes or a
 * night away — so this cannot block. It **suspends**, exactly like the
 * confirm-gate (M7): it raises a durable attention item and returns a "stop and
 * wait" message, so the turn ends holding no lease and burning no tokens. When
 * the operator resolves it (with an answer) or dismisses it (with a reason), a
 * fresh turn is dispatched into this session and the agent carries on.
 *
 * This is what an agent reaches for when it needs a person — a `question` it
 * cannot answer, a `decision` only the operator can make, a `review` of what it
 * produced, or a `failure` it hit and cannot clear (a denied tool, a missing
 * credential). It is the agent's own decision to stop, where the gate's is
 * forced on it.
 */
export interface AttentionToolContext {
  tenantId: string
  agent: string
  session: string
  jobId?: number
}

export function attachAttentionTool(context: AttentionToolContext): void {
  useTool(
    defineTool({
      name: "attention_request",
      description:
        "Stop and ask the operator when you need a person and cannot proceed on your own: a question you can't answer, a decision only they can make, a review of your work, or a failure you hit and can't clear (a denied tool, a missing credential). This ends your turn — you'll be resumed with their answer in a new turn. Don't use it for things you can work out or try another way; use it when you are genuinely stuck.",
      input: v.object({
        kind: v.picklist(["question", "decision", "review", "failure"]),
        title: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(180),
          v.description("One line: what you need from the operator"),
        ),
        detail: v.optional(
          v.pipe(
            v.string(),
            v.maxLength(2_000),
            v.description("What you tried and the exact error, if any"),
          ),
        ),
      }),
      run: async ({ data }) => {
        getAttentionStore().raiseRequest({
          tenantId: context.tenantId,
          agent: context.agent,
          session: context.session,
          jobId: context.jobId ?? null,
          kind: data.kind,
          title: data.title,
          detail: data.detail ?? null,
        })
        return `Raised for the operator (${data.kind}): ${data.title}. Stop here — you will be resumed with their answer.`
      },
    }),
  )
}
