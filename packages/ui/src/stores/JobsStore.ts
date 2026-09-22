import { action, makeObservable, observable, runInAction } from "mobx"
import { type JobRow, api } from "../lib/api.ts"

/** The job board. Refetched whenever the coordinator pulses `job.state.changed`. */
export class JobsStore {
  @observable jobs: JobRow[] = []

  constructor() {
    makeObservable(this)
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const jobs = await api.jobs.list()
      runInAction(() => {
        this.jobs = jobs
      })
    } catch {
      // Keep the last board.
    }
  }
}
