import { AttentionStore } from "./AttentionStore.ts"
import { ChatsStore } from "./ChatsStore.ts"
import { CodexUsageStore } from "./CodexUsageStore.ts"
import { DraftsStore } from "./DraftsStore.ts"
import { InboxStore } from "./InboxStore.ts"
import { JobsStore } from "./JobsStore.ts"
import { type OperatorEvent, watchOperatorStream } from "./operator-stream.ts"
import { PaletteStore } from "./PaletteStore.ts"
import { PresenceStore } from "./PresenceStore.ts"
import { RosterStore } from "./RosterStore.ts"
import { SchedulesStore } from "./SchedulesStore.ts"
import { ShortcutsStore } from "./ShortcutsStore.ts"

/**
 * The app's data layer. One root that holds a small store per domain — the
 * prototype's single `AppStore` split up so each concern is its own file — and
 * owns the one connection to the operator event stream.
 *
 * The root itself holds nothing observable: the sub-stores are stable
 * references, and each carries its own `@observable` state. So the root needs no
 * MobX — it just wires the stream to the stores.
 *
 * `connect()` does the initial load of the always-on slices (roster, attention,
 * unread, jobs), opens the stream, and thereafter refreshes only the slice each event
 * names. There are no timers: freshness is a push. Screens read these observable
 * stores through `observer()` and re-render when their slice moves.
 */
export class RootStore {
  readonly roster = new RosterStore()
  readonly presence = new PresenceStore()
  readonly attention = new AttentionStore()
  readonly chats = new ChatsStore()
  // Lazy: loaded when the inbox is first opened, then kept live off the stream.
  readonly inbox = new InboxStore()
  readonly jobs = new JobsStore()
  readonly schedules = new SchedulesStore()
  // Lazy and self-driven (a five-minute poll started by the composer gauge), so
  // it is not part of connect()'s always-on load.
  readonly codexUsage = new CodexUsageStore()
  // Pure localStorage facade for composer drafts; no load, no stream.
  readonly drafts = new DraftsStore()
  // Configurable keyboard-shortcut bindings; seeded from localStorage.
  readonly shortcuts = new ShortcutsStore()
  // Whether the ⌘K command palette is open; pure UI state, no load or stream.
  readonly palette = new PaletteStore()

  #disconnect: (() => void) | undefined
  readonly #listeners = new Set<(event: OperatorEvent) => void>()

  /**
   * Subscribe to raw operator events. The domain stores cover the list slices;
   * this is for a screen showing a single entity (a job, a schedule) that must
   * refetch its own detail when the stream says its kind changed.
   */
  onEvent(listener: (event: OperatorEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Start the data layer. Returns a disposer; calling twice is a no-op reconnect. */
  connect(): () => void {
    this.#disconnect?.()
    void this.roster.load()
    void this.presence.load()
    void this.attention.load()
    // The rail always shows active-job work, not only the Jobs and Home views.
    void this.jobs.load()
    this.#disconnect = watchOperatorStream((event) => this.#handle(event))
    return () => {
      this.#disconnect?.()
      this.#disconnect = undefined
    }
  }

  #handle(event: OperatorEvent): void {
    // Most events can move an agent's rail overview (activity, unread, or a
    // raised/resolved attention item), so refresh it. A schedule or widget change
    // touches neither, so it is left out.
    if (event.type !== "schedule.changed" && event.type !== "widget.changed") {
      void this.presence.load()
    }
    switch (event.type) {
      case "attention.changed":
        void this.attention.load()
        break
      case "agent.unread.changed":
        // The rail overview is refreshed above; here just keep an open tab
        // strip's per-chat badges honest. An unread bump for an agent we've
        // never viewed needs nothing more.
        if (this.chats.isLoaded(event.agent)) void this.chats.loadChats(event.agent)
        if (this.inbox.loaded) void this.inbox.load()
        break
      case "agent.activity.changed":
        if (this.chats.isLoaded(event.agent)) void this.chats.loadChats(event.agent)
        if (this.inbox.loaded) void this.inbox.load()
        break
      case "job.state.changed":
        void this.jobs.load()
        break
      case "schedule.changed":
        void this.schedules.load()
        break
    }
    // Let single-entity detail screens react too (a job page, a schedule page).
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch (error) {
        console.warn("[stores] an operator-event listener threw:", error)
      }
    }
  }
}
