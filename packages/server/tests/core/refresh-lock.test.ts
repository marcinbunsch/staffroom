import { describe, expect, it } from "vitest"
import { withRefreshLock } from "../../src/core/refresh-lock.ts"

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

describe("withRefreshLock", () => {
  it("runs work for one key one at a time, in call order", async () => {
    const order: string[] = []
    const work = (id: string) => async () => {
      order.push(`${id}:start`)
      await tick()
      order.push(`${id}:end`)
      return id
    }
    const results = await Promise.all([
      withRefreshLock("k", work("a")),
      withRefreshLock("k", work("b")),
      withRefreshLock("k", work("c")),
    ])
    expect(results).toEqual(["a", "b", "c"])
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"])
  })

  it("lets different keys run concurrently", async () => {
    const order: string[] = []
    const work = (id: string) => async () => {
      order.push(`${id}:start`)
      await tick()
      order.push(`${id}:end`)
    }
    await Promise.all([withRefreshLock("a", work("a")), withRefreshLock("b", work("b"))])
    expect(order).toEqual(["a:start", "b:start", "a:end", "b:end"])
  })

  it("does not let a failure poison the queue behind it", async () => {
    const failing = withRefreshLock("k", async () => {
      await tick()
      throw new Error("refresh rejected")
    })
    const following = withRefreshLock("k", async () => "ok")
    await expect(failing).rejects.toThrow("refresh rejected")
    await expect(following).resolves.toBe("ok")
  })

  it("forgets a key once its queue drains, so it does not grow without bound", async () => {
    await withRefreshLock("k", async () => "first")
    const order: string[] = []
    await Promise.all([
      withRefreshLock("k", async () => void order.push("second")),
      withRefreshLock("k", async () => void order.push("third")),
    ])
    expect(order).toEqual(["second", "third"])
  })
})
