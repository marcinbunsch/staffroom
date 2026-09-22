import { autorun, runInAction } from "mobx"
import { expect, it } from "vitest"
import { PresenceStore } from "./PresenceStore.ts"
import { RosterStore } from "./RosterStore.ts"

// Guards the class-fields gotcha: MobX 6 legacy `@observable` fields under
// `useDefineForClassFields: true` must still notify observers when reassigned.
// If they don't, the whole data layer silently stops updating the UI.

it("notifies when an @observable array field is reassigned", () => {
  const store = new RosterStore()
  const seen: number[] = []
  const dispose = autorun(() => seen.push(store.members.length))
  runInAction(() => {
    store.members = [{ id: "a", name: "A" } as (typeof store.members)[number]]
  })
  dispose()
  expect(seen).toEqual([0, 1])
})

it("notifies when an @observable Map field is reassigned", () => {
  const store = new PresenceStore()
  const seen: (string | undefined)[] = []
  const dispose = autorun(() => seen.push(store.overviewFor("devops")?.activity))
  runInAction(() => {
    store.byAgent = new Map([
      [
        "devops",
        {
          id: "devops",
          activity: "working",
          label: null,
          jobId: null,
          unreadCount: 0,
          attention: null,
        },
      ],
    ])
  })
  dispose()
  expect(seen).toEqual([undefined, "working"])
})
