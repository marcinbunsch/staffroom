"use agent"
import {
  type AgentProps,
  useAgentStart,
  useModel,
  useResponseFinish,
  useResponseStart,
} from "@flue/runtime"
import { parseSessionKey } from "@staffroom/protocol"
import { getJobsCoordinator } from "../coordinator/jobs.ts"
import { renderOperatorProfile } from "../coordinator/operator-profile.ts"
import { attachChatTools } from "../tools/chat-tools.ts"
import { attachCompactTools } from "../tools/compact-tools.ts"
import { attachCurrentTimeTool } from "../tools/current-time.ts"
import { attachDelegateTool } from "../tools/delegate.ts"
import { attachFileTools } from "../tools/file-tools.ts"
import { attachJobTools } from "../tools/job-tools.ts"
import { attachMemoryTools } from "../tools/memory-tools.ts"
import { attachMemoryContext } from "../tools/memory-context.ts"
import { attachScheduleTools } from "../tools/schedule-tools.ts"
import { attachSearchTool } from "../tools/search-tool.ts"
import { attachWidgetTools } from "../tools/widget-tools.ts"
import { attachAskAgentTool } from "../tools/ask-agent.ts"
import { attachAttentionTool } from "../tools/attention-request.ts"
import { attachListStaffTool } from "../tools/list-staff.ts"
import { attachSkills } from "../tools/skills.ts"
import { resolveAgentSession } from "./resolve-session.ts"

// Only reached when a session cannot be resolved, where the reply is a sentence
// of explanation rather than any real work.
// Never actually called: this branch returns a plain string, so no model turn
// runs — the id only satisfies useModel()'s signature on a dead-end render.
const FALLBACK_MODEL = "openai-codex/gpt-5-codex"

// The UI renders two fenced code languages as live charts — everywhere markdown
// appears (chat replies and the files/artifacts an agent writes). Told here, not
// per member, so every agent can reach for a chart when it clarifies. Kept to
// what an agent needs to emit valid fences; the renderer supplies the theme.
const CHART_GUIDANCE = [
  "When a chart communicates better than prose or a table, emit one as a fenced code block — it renders inline in chat and in any markdown file you write.",
  "- Data charts (bar, line, scatter, area): a ```vega-lite fence whose body is a Vega-Lite JSON spec. Put the data inline under `data.values`; omit width/height and colours — the app themes and sizes it.",
  "- Diagrams (flowchart, sequence, gantt, ER, state): a ```mermaid fence with Mermaid syntax.",
  "Use charts sparingly and only for real data or structure — never decoration. A malformed fence shows as its raw source, so keep specs valid.",
].join("\n")

/**
 * One Flue agent that becomes whichever staff member the session addresses.
 * The roster is data, so adding a member is an insert rather than a deploy, and
 * editing a row changes behaviour on the very next turn.
 *
 * The render is deliberately thin: it turns a resolution into hooks and a
 * prompt, and nothing else. All the judgement — parsing the tenant out of the
 * session key, finding the member, choosing the credential that pays — lives in
 * `resolveAgentSession`, which takes the session key and the stores and no
 * ambient input at all. That is what makes it testable, and testable is what
 * makes the tenancy claim checkable: a job resumed from Flue's poll loop
 * renders here with no request and no context, so the session key has to be
 * sufficient on its own.
 */
export function StaffAgent({ id }: AgentProps) {
  const resolution = resolveAgentSession(id)
  if (resolution.kind !== "ready") {
    // A job session that cannot resolve (no credential, member removed) would
    // otherwise hang forever: the render returns a message but never registers
    // the `useAgentStart` that moves the job off `assigned`, so nothing surfaces
    // it. Fail the job loudly instead — it becomes visible on the board and the
    // operator can restart it once the cause (usually a missing credential) is
    // fixed. `fail` is idempotent, so a redelivery does not stack failures.
    const identity = parseSessionKey(id)
    if (identity?.jobId !== undefined) {
      getJobsCoordinator().fail(identity.tenantId, identity.jobId, resolution.message)
    }
    useModel(FALLBACK_MODEL)
    return resolution.message
  }

  useModel(resolution.model)
  // Flue stamps nothing on a message — metadata is whatever the agent attaches.
  // Without these the transcript cannot say when anything was said, and the
  // audit tap (M2) has no usage to price or credential to attribute it to.
  useResponseStart(() => ({ startedAt: new Date().toISOString() }))
  useResponseFinish(({ response }) => ({
    usage: response.usage,
    credentialId: resolution.credentialId,
    // Pair to startedAt so the transcript can show how long a turn took and its
    // output token rate. Stamped at finish, so it only lands on settled turns.
    finishedAt: new Date().toISOString(),
  }))

  // Every agent can open, delegate and list jobs; a job session also gets the
  // working set bound to that job. Tools are bound with the tenant, because
  // Flue does not tell a tool who called it.
  const { identity } = resolution
  attachJobTools({
    tenantId: identity.tenantId,
    agent: identity.agentId,
    session: id,
    jobId: identity.jobId,
  })
  // Every agent can write, read and list files — its own, plus what the
  // organization shares. Promotion to shared is a human's call, so no tool.
  attachFileTools({
    tenantId: identity.tenantId,
    agent: identity.agentId,
    session: id,
    jobId: identity.jobId,
  })
  // Produce durable, self-updating outputs — a Markdown block or a Vega-Lite
  // chart — that render on the agent's board and on dashboards. Keyed, so a
  // schedule updates the same widget in place. Built-in, ungated, tenant-private.
  attachWidgetTools({ tenantId: identity.tenantId, agent: identity.agentId })
  // Keyword search over readable files. The agent archive has its own tools.
  attachSearchTool({ tenantId: identity.tenantId })
  // The clock — a built-in every agent always has, needing no grant.
  attachCurrentTimeTool()
  // Delegate a focused task to a child agent that shares this agent's tools and
  // sandbox but runs in a fresh context — for map-reduce over large data.
  attachDelegateTool()
  // The archive contributes a bounded, durable evidence signal beside each
  // operator/job delivery; tools remain available for deeper or mid-turn lookup.
  attachMemoryContext({ tenantId: identity.tenantId, agent: identity.agentId })
  attachMemoryTools({ tenantId: identity.tenantId, agent: identity.agentId, session: id })
  // Set/list/remove the agent's own schedules (recurring or one-off) from conversation.
  attachScheduleTools({ tenantId: identity.tenantId, agent: identity.agentId })
  // Name the current chat once its topic is clear, so the operator can find and
  // switch to it. Only chat sessions have a chat to rename; a job session has none.
  if (identity.jobId === undefined) {
    attachChatTools({ tenantId: identity.tenantId, agent: identity.agentId, session: id })
  }
  // The agent’s skills (own + org directory), plus a tool to write more.
  attachSkills({ tenantId: identity.tenantId, agent: identity.agentId })
  // See the roster — who to ask or hand off to — then ask another agent a
  // question, blocking until they answer (M11).
  attachListStaffTool({ tenantId: identity.tenantId })
  attachAskAgentTool({ tenantId: identity.tenantId, agent: identity.agentId })
  // Escalate to the operator and stop — suspends the turn, resumes on the reply.
  attachAttentionTool({
    tenantId: identity.tenantId,
    agent: identity.agentId,
    session: id,
    jobId: identity.jobId,
  })
  // Everything the member is granted beyond the built-ins, in one pass through
  // the toolset-type registry: catalog/plugin tools bound with their credentials
  // and skipped if unconnected; MCP tools; and a sandbox toolset (which attaches
  // a container environment). All team-gated, and surfaced *compactly* — a
  // one-line list plus describe_tool/call_tool rather than a full schema each. A
  // gated tool still suspends for operator approval when call_tool reaches it
  // (M7). Built-ins above stay mounted in full.
  attachCompactTools(resolution.member.tools, {
    tenantId: identity.tenantId,
    agent: identity.agentId,
    session: id,
    jobId: identity.jobId,
  })

  // Who the operator is, prepended so the agent can tell which of the many
  // names it meets in Slack, GitHub, and mail is the person it works for. Read
  // fresh each render (per tenant) and stable while unchanged, so it steers
  // every session type without churning the prompt cache. Empty until written.
  const operatorProfile = renderOperatorProfile(identity.tenantId)
  const base =
    operatorProfile === ""
      ? resolution.member.systemPrompt
      : `${operatorProfile}\n\n${resolution.member.systemPrompt}`
  const preamble = `${base}\n\n${CHART_GUIDANCE}`

  // An agent-to-agent thread: answer the counterpart's question directly and
  // concisely. It is a question, not a task — so do not open a job for it; if
  // it turns out to need real work, say so and let them open one.
  if (identity.counterpart !== undefined) {
    return `${preamble}\n\nYou are answering a question from @${identity.counterpart} in a direct thread. Answer concisely with what you know and your own tools. This is a quick question, not a job — do not open a job to answer it.`
  }

  if (identity.jobId === undefined) return preamble

  // A job session: mark the job started, and steer the agent toward closing it.
  const jobId = identity.jobId
  useAgentStart(() =>
    getJobsCoordinator().markWorking(identity.tenantId, jobId, {
      kind: "agent",
      id: identity.agentId,
    }),
  )
  const job = getJobsCoordinator().get(identity.tenantId, jobId)
  const jobContext = job
    ? `You are working Job #${job.id}: "${job.title}". Do the work with your tools, record progress with job_note, and when you are done call job_close with a concise summary of what you found or did.`
    : "You are in a job session but the job record could not be loaded; proceed carefully."
  return `${preamble}\n\n${jobContext}`
}
