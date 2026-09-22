import type { CodexUsage } from "@staffroom/protocol"
import { action, makeObservable, observable, runInAction } from "mobx"
import { api } from "../lib/api.ts"

/** Plan usage moves slowly; a five-minute pulse is plenty. */
const POLL_MS = 5 * 60_000

/**
 * Codex plan usage for the composer gauge — one shared poller for the whole app.
 *
 * Unlike the always-on stores, this one is lazy and reference-counted: the first
 * gauge to mount starts a single five-minute poll, every gauge reads the same
 * observable snapshot, and the last to unmount stops it. So N composers on
 * screen make one request per five minutes, not N — the dedup lives here rather
 * than in a server cache or in each component.
 */
export class CodexUsageStore {
  /** undefined until the first load settles; null when there's no login or it's unreachable. */
  @observable usage: CodexUsage | null | undefined = undefined

  #subscribers = 0
  #timer: ReturnType<typeof setInterval> | undefined

  constructor() {
    makeObservable(this)
  }

  /**
   * Share the poll for a mounted gauge; returns a disposer. The first subscriber
   * fetches immediately and opens the interval; the last to leave closes it.
   */
  subscribe(): () => void {
    this.#subscribers += 1
    if (this.#subscribers === 1) {
      void this.load()
      this.#timer = setInterval(() => void this.load(), POLL_MS)
    }
    return () => {
      this.#subscribers -= 1
      if (this.#subscribers === 0) {
        clearInterval(this.#timer)
        this.#timer = undefined
      }
    }
  }

  @action.bound
  async load(): Promise<void> {
    try {
      const usage = await api.models.codexUsage()
      runInAction(() => {
        this.usage = usage
      })
    } catch {
      // A blip shouldn't blank a good reading, but a first-load failure should
      // resolve the undefined "loading" state to null so the gauge stays hidden.
      runInAction(() => {
        this.usage = this.usage ?? null
      })
    }
  }
}
