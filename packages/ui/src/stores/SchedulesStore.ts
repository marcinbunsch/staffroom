import { action, makeObservable, observable, runInAction } from "mobx"
import { type ScheduleRow, api } from "../lib/api.ts"

/** The schedules list. Loaded on demand; refreshed off the job pulse. */
export class SchedulesStore {
  @observable schedules: ScheduleRow[] = []

  constructor() {
    makeObservable(this)
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const schedules = await api.schedules.list()
      runInAction(() => {
        this.schedules = schedules
      })
    } catch {
      // Keep the last list.
    }
  }
}
