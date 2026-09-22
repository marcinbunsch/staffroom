import {
  type AgentOverviewList,
  AgentOverviewList as AgentOverviewListSchema,
  type AttentionItem,
  type Job,
  type StaffMember,
} from "@staffroom/protocol"
import type { ActivityTracker } from "./activity.ts"

// The job states that count as an agent actively working, for the rail dot.
const ACTIVE_JOB_STATES = new Set(["assigned", "working", "waiting_children"])

/**
 * Resolve each roster member to a single live overview, ported from the
 * prototype's `agentOverview`. Precedence: an open attention item (needs you, or
 * failed) outranks replying in a chat, which outranks a running job, which
 * outranks idle. Unread always rides along. The label is a compact description —
 * never a prompt or a tool's contents.
 */
export function agentOverview(
  tenantId: string,
  staff: StaffMember[],
  jobs: Job[],
  activity: ActivityTracker,
  unread: Record<string, number>,
  attention: AttentionItem[],
): AgentOverviewList {
  return AgentOverviewListSchema.parse({
    agents: staff.map((member) => {
      const unreadCount = unread[member.id] ?? 0
      const item = attention.find((candidate) => candidate.agent === member.id)
      if (item) {
        return {
          id: member.id,
          activity: item.kind === "failure" ? "failed" : "needs_you",
          label: item.title,
          jobId: item.jobId && item.jobId > 0 ? item.jobId : null,
          unreadCount,
          attention: { id: item.id, kind: item.kind, title: item.title },
        }
      }
      if (activity.isResponding(tenantId, member.id)) {
        return {
          id: member.id,
          activity: "responding",
          label: "Replying in chat",
          jobId: null,
          unreadCount,
          attention: null,
        }
      }
      const job = jobs.find(
        (candidate) =>
          candidate.assigneeAgent === member.id && ACTIVE_JOB_STATES.has(candidate.state),
      )
      if (job) {
        return {
          id: member.id,
          activity: "working",
          label: `Working on: ${job.title}`,
          jobId: job.id,
          unreadCount,
          attention: null,
        }
      }
      return {
        id: member.id,
        activity: "idle",
        label: null,
        jobId: null,
        unreadCount,
        attention: null,
      }
    }),
  })
}
