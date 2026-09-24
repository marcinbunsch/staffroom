import { INBOX_PAGE } from "@staffroom/protocol"
import { action, makeObservable, observable, runInAction } from "mobx"
import { type TabChatRow, api } from "../lib/api.ts"

/**
 * The inbox: every replied-to open chat across agents, unread first then by
 * latest reply. Loaded lazily (only once the operator opens it), then refreshed
 * off the stream's unread/activity pulses like the tab strips. It holds a
 * growing window rather than pages — "show more" widens it, and a refresh
 * refetches the whole window so a row that moved up never duplicates.
 */
export class InboxStore {
  @observable chats: TabChatRow[] = []
  @observable total = 0
  @observable loaded = false
  #window = INBOX_PAGE

  constructor() {
    makeObservable(this)
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const page = await api.chats.inbox(this.#window, 0)
      runInAction(() => {
        this.chats = page.chats
        this.total = page.total
        this.loaded = true
      })
    } catch {
      // Keep the last inbox.
    }
  }

  @action.bound
  async loadMore(): Promise<void> {
    this.#window += INBOX_PAGE
    await this.load()
  }

  /** Optimistically mark a row read; the stream's unread pulse reconciles. */
  @action.bound
  async markRead(chat: TabChatRow): Promise<void> {
    this.chats = this.chats.map((row) => (row.id === chat.id ? { ...row, unread: 0 } : row))
    await api.chats.markRead(chat.id).catch(() => undefined)
    await this.load()
  }

  /** Archive is closing the chat: it leaves the tabs and the inbox, and lands in history. */
  @action.bound
  async archive(chat: TabChatRow): Promise<void> {
    this.chats = this.chats.filter((row) => row.id !== chat.id)
    this.total = Math.max(0, this.total - 1)
    await api.chats.close(chat.id).catch(() => undefined)
    await this.load()
  }
}
