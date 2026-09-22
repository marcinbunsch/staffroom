import type { AttentionItem, Job, StaffMember } from "@staffroom/protocol"
import { describe, expect, it } from "vitest"
import { ActivityTracker } from "../../src/coordinator/activity.ts"
import { agentOverview } from "../../src/coordinator/presence.ts"

// Only the fields agentOverview reads; the rest of each row is irrelevant here.
const member = (id: string): StaffMember => ({ id }) as unknown as StaffMember
const job = (assigneeAgent: string, state: string, id: number, title: string): Job =>
  ({ id, title, state, assigneeAgent }) as unknown as Job
const attention = (
  agent: string,
  kind: string,
  title: string,
  jobId: number | null = null,
): AttentionItem => ({ id: `att-${agent}`, agent, kind, title, jobId }) as unknown as AttentionItem

const TENANT = "t1"

function overviewFor(
  agent: string,
  options: {
    jobs?: Job[]
    unread?: Record<string, number>
    attention?: AttentionItem[]
    activity?: ActivityTracker
  } = {},
) {
  const list = agentOverview(
    TENANT,
    [member(agent)],
    options.jobs ?? [],
    options.activity ?? new ActivityTracker(),
    options.unread ?? {},
    options.attention ?? [],
  )
  return list.agents[0]
}

describe("agentOverview", () => {
  it("is idle with unread carried when nothing is happening", () => {
    expect(overviewFor("a", { unread: { a: 3 } })).toMatchObject({
      activity: "idle",
      label: null,
      unreadCount: 3,
      attention: null,
    })
  })

  it("is working when the agent holds an active job", () => {
    const result = overviewFor("a", { jobs: [job("a", "working", 7, "Ship it")] })
    expect(result).toMatchObject({ activity: "working", label: "Working on: Ship it", jobId: 7 })
  })

  it("is responding when a chat turn is in flight", () => {
    const activity = new ActivityTracker()
    activity.begin(TENANT, "a", `${TENANT}:a`)
    expect(overviewFor("a", { activity })).toMatchObject({
      activity: "responding",
      label: "Replying in chat",
    })
  })

  it("needs you for an open request, and fails for a failure item", () => {
    expect(
      overviewFor("a", { attention: [attention("a", "question", "Which env?")] }),
    ).toMatchObject({
      activity: "needs_you",
      label: "Which env?",
      attention: { kind: "question", title: "Which env?" },
    })
    expect(
      overviewFor("a", { attention: [attention("a", "failure", "It crashed")] }),
    ).toMatchObject({
      activity: "failed",
    })
  })

  it("ranks attention over responding over working", () => {
    const activity = new ActivityTracker()
    activity.begin(TENANT, "a", `${TENANT}:a`)
    const result = overviewFor("a", {
      jobs: [job("a", "working", 1, "Job")],
      activity,
      attention: [attention("a", "decision", "Pick one")],
    })
    expect(result?.activity).toBe("needs_you")
  })
})
