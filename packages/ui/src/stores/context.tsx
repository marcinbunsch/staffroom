import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"
import { observer } from "mobx-react-lite"
import { syncAppBadge } from "../lib/app-badge.ts"
import { RootStore } from "./RootStore.ts"
import { type OperatorEvent } from "./operator-stream.ts"

/**
 * One `RootStore` for the app, handed down by context. A single instance is the
 * right shape — the data layer mirrors one server — so it is created once here
 * and `useStores()` reads it anywhere below the provider.
 */
const store = new RootStore()
const StoreContext = createContext<RootStore>(store)

/** Provide the store and keep the operator stream connected for the tree's life. */
export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => store.connect(), [])
  return (
    <StoreContext.Provider value={store}>
      <BadgeSync />
      {children}
    </StoreContext.Provider>
  )
}

/**
 * Keep the app-icon badge in lockstep with the same observable counts the UI
 * shows — the desktop Dock badge and the installed-PWA badge alike.
 */
const BadgeSync = observer(function BadgeSync() {
  const unread = [...store.presence.byAgent.values()].reduce(
    (total, overview) => total + overview.unreadCount,
    0,
  )
  const attention = store.attention.count
  useEffect(() => syncAppBadge(unread, attention), [unread, attention])
  return null
})

export function useStores(): RootStore {
  return useContext(StoreContext)
}

/**
 * Run `handler` whenever an operator event arrives — for a screen that shows one
 * entity and must refetch its own detail on a pulse (a job page on
 * `job.state.changed`, a schedule page on `schedule.changed`). The latest handler
 * is always used, so it can close over fresh props without re-subscribing.
 */
export function useOperatorEvent(handler: (event: OperatorEvent) => void): void {
  const store = useStores()
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => store.onEvent((event) => ref.current(event)), [store])
}
