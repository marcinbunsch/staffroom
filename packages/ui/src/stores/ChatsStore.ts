import { action, makeObservable, observable, runInAction } from "mobx"
import { type TabChatRow, api } from "../lib/api.ts"

/**
 * A member's conversations, plus the per-agent unread totals for the rail. The
 * unread map is always loaded; the per-agent tab strips are loaded lazily, only
 * for agents the operator has actually opened, and refreshed off the stream.
 */
export class ChatsStore {
  @observable byAgent = new Map<string, TabChatRow[]>()
  @observable historyCount = new Map<string, number>()

  constructor() {
    makeObservable(this)
  }

  /** Optimistically remove a chat from an agent's tab strip; a reload reconciles. */
  @action.bound
  dropChat(agent: string, chatId: number): void {
    const list = this.byAgent.get(agent)
    if (list)
      this.byAgent.set(
        agent,
        list.filter((chat) => chat.id !== chatId),
      )
  }

  chatsFor(agent: string): TabChatRow[] {
    return this.byAgent.get(agent) ?? []
  }

  historyCountFor(agent: string): number {
    return this.historyCount.get(agent) ?? 0
  }

  /** Whether this agent's tab strip has been loaded — so the stream only refetches visited ones. */
  isLoaded(agent: string): boolean {
    return this.byAgent.has(agent)
  }

  @action.bound
  async loadChats(agent: string): Promise<void> {
    try {
      const { chats, historyCount } = await api.chats.list(agent)
      runInAction(() => {
        this.byAgent.set(agent, chats)
        this.historyCount.set(agent, historyCount)
      })
    } catch {
      // Keep the last tab strip for this agent.
    }
  }
}
