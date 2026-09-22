/**
 * Which chat sessions have a turn in flight right now.
 *
 * In-memory and deliberately so: presence is live state, not history, and after
 * a restart nothing is in flight. Fed by the Flue observer (agent_start adds,
 * agent_end/agent_error removes); read by the chats endpoint to light the "at
 * work" dot on a tab the operator is not currently looking at.
 */
export class ActivityTracker {
  readonly #active = new Map<string, { tenantId: string; agent: string }>()

  begin(tenantId: string, agent: string, session: string): void {
    this.#active.set(session, { tenantId, agent })
  }

  end(session: string): void {
    this.#active.delete(session)
  }

  /** The active sessions for one agent, for the tab dots. */
  sessions(tenantId: string, agent: string): string[] {
    const active: string[] = []
    for (const [session, owner] of this.#active) {
      if (owner.tenantId === tenantId && owner.agent === agent) active.push(session)
    }
    return active
  }

  isActive(session: string): boolean {
    return this.#active.has(session)
  }

  /** Whether this agent has any chat turn in flight — it is replying right now. */
  isResponding(tenantId: string, agent: string): boolean {
    return this.sessions(tenantId, agent).length > 0
  }
}

let tracker: ActivityTracker | undefined

export function getActivityTracker(): ActivityTracker {
  if (!tracker) tracker = new ActivityTracker()
  return tracker
}
