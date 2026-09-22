import { defineTool, useTool } from "@flue/runtime"
import { composeSessionKey } from "@staffroom/protocol"
import * as v from "valibot"
import { getRosterStore } from "../coordinator/roster.ts"

/**
 * A question to another agent is a blocking tool call.
 *
 * `pm` calls `ask_agent(to: "code", …)`. The call dispatches the question into
 * the `pm`↔`code` thread — a session where `code` renders with its usual prompt,
 * memory and tools — waits for that turn to settle, and returns the answer as
 * the tool's return value. `pm` never left its own turn, so there is no return
 * address to route back to, no relay at settlement, and no queue: awaiting is
 * the backpressure.
 *
 * The timeout is the boundary between a question and a job. Below it, questions;
 * above it, real work. 60s is well inside Flue's one-hour submission timeout,
 * which is exactly what makes blocking safe here and unsafe for a human confirm
 * (M7) — the two look alike and are not.
 *
 * Loop protection is deferred, as the prototype's design deferred it: blocking
 * already bounds a ping-pong to a call stack under the timeout and makes it
 * visible in the audit. The durable fix is the shared causation chain (M4/M11
 * note in the plan), carried through the dispatch and refused on re-entry; it
 * lands when something actually loops.
 */

/** How the tool reaches Flue's dispatch/read, injected so this module needs no agent import. */
export type AskAgentDeliver = (threadSession: string, message: string) => Promise<{ text: string }>

let deliver: AskAgentDeliver | undefined

export function setAskAgentDeliver(fn: AskAgentDeliver): void {
  deliver = fn
}

export interface AskAgentContext {
  tenantId: string
  agent: string
}

const TIMEOUT_MS = 60_000

export function attachAskAgentTool(context: AskAgentContext): void {
  useTool(
    defineTool({
      name: "ask_agent",
      description:
        "Ask another staff member a question and get their answer back in this same turn. Use for a quick request-response — 'has the PR merged?', 'what's the status of X?'. For real, multi-step work, open a job instead (job_create). The other agent answers with its own tools and knowledge; you carry on with the answer in hand.",
      input: v.object({
        to: v.pipe(v.string(), v.minLength(1), v.description("The staff id to ask, without @")),
        question: v.pipe(v.string(), v.minLength(1), v.description("The question to ask")),
      }),
      run: async ({ data }) => {
        if (data.to === context.agent) return "You cannot ask yourself; think it through directly."
        if (!getRosterStore().get(context.tenantId, data.to)) {
          return `No such staff member "${data.to}".`
        }
        if (!deliver) throw new Error("[ask_agent] deliver not configured")

        // The thread session where `to` renders and answers, with this agent as
        // the counterpart. One thread per pair, reused across questions.
        const threadSession = composeSessionKey({
          tenantId: context.tenantId,
          agentId: data.to,
          counterpart: context.agent,
        })
        const question = `Question from @${context.agent}:\n\n${data.question}`

        try {
          const { text } = await withTimeout(deliver(threadSession, question), TIMEOUT_MS)
          return text.trim() || `@${data.to} answered with nothing.`
        } catch (error) {
          if (error instanceof AskTimeoutError) {
            return `@${data.to} did not answer within ${TIMEOUT_MS / 1000}s. If this needs real work rather than a quick answer, open a job instead (job_create).`
          }
          return `Asking @${data.to} failed: ${error instanceof Error ? error.message : String(error)}`
        }
      },
    }),
  )
}

class AskTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AskTimeoutError()), ms)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
