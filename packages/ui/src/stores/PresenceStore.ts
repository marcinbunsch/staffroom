import { action, makeObservable, observable, runInAction } from "mobx"
import { type AgentOverview, api } from "../lib/api.ts"

/**
 * The rail's live view of the roster: one overview per agent — activity, unread,
 * a compact label, any open attention. Ported from the prototype's `presence`
 * map. One `api.staff.overview()` call resolves all of it server-side, and the
 * store refreshes it on every operator event, so a status dot, an unread badge
 * and a name weight all move from the same source.
 */
export class PresenceStore {
  @observable byAgent = new Map<string, AgentOverview>()

  constructor() {
    makeObservable(this)
  }

  overviewFor(agent: string): AgentOverview | undefined {
    return this.byAgent.get(agent)
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const agents = await api.staff.overview()
      runInAction(() => {
        this.byAgent = new Map(agents.map((overview) => [overview.id, overview]))
      })
    } catch {
      // Keep the last overview rather than blanking every dot on a blip.
    }
  }
}
