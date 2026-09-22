import { action, makeObservable, observable, runInAction } from "mobx"
import { type StaffRow, api } from "../lib/api.ts"

/** The staff roster — one list, loaded once and kept fresh by the stream. */
export class RosterStore {
  @observable members: StaffRow[] = []

  constructor() {
    makeObservable(this)
  }

  nameOf(id: string): string {
    return this.members.find((member) => member.id === id)?.name ?? id
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const members = await api.staff.list()
      runInAction(() => {
        this.members = members
      })
    } catch {
      // Keep the last good roster rather than blanking the rail on a blip.
    }
  }
}
