import { action, computed, makeObservable, observable, runInAction } from "mobx"
import { type AttentionRow, api } from "../lib/api.ts"

/**
 * The attention board: every open approval and agent request. The count drives
 * the rail badge; the items drive the board. Actions optimistically drop the
 * item they resolve, and the `attention.changed` the server publishes reconciles
 * the list a moment later.
 */
export class AttentionStore {
  @observable items: AttentionRow[] = []

  constructor() {
    makeObservable(this)
  }

  @computed get count(): number {
    return this.items.length
  }

  @computed get approvals(): AttentionRow[] {
    return this.items.filter((item) => item.kind === "approval")
  }

  @computed get requests(): AttentionRow[] {
    return this.items.filter((item) => item.kind !== "approval")
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const items = await api.attention.list()
      runInAction(() => {
        this.items = items
      })
    } catch {
      // Leave the board as-is on a transient failure.
    }
  }

  @action.bound
  async answer(
    item: AttentionRow,
    decision: "approved" | "denied",
    reason?: string,
  ): Promise<void> {
    if (!item.approvalId) return
    await api.attention.answerApproval(item.approvalId, decision, reason)
    this.#drop(item)
  }

  @action.bound
  async resolve(item: AttentionRow, note?: string): Promise<void> {
    await api.attention.resolve(item.id, note)
    this.#drop(item)
  }

  @action.bound
  async dismiss(item: AttentionRow, note: string): Promise<void> {
    await api.attention.dismiss(item.id, note)
    this.#drop(item)
  }

  #drop(item: AttentionRow): void {
    runInAction(() => {
      this.items = this.items.filter((row) => row.id !== item.id)
    })
  }
}
