import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router"
import { useStores } from "../stores/context.tsx"
import { api } from "./api.ts"
import { chatOnClose, chatOnShow, lastChatId } from "./last-chat.ts"
import { type ShortcutAction } from "./shortcuts.ts"

// `/a/<agentId>` optionally followed by `/c/<chatId>`. Anchored so the ids come
// straight off the path the app already routes on.
const AGENT_PATH = /^\/a\/([^/]+)(?:\/c\/(\d+))?/

/**
 * Wire the configurable navigation shortcuts to a single global key handler.
 * Mounted once in the shell: it reads the open agent/chat from the URL, cycles
 * the roster or the agent's tab strip, and navigates. Both stores are observable,
 * but the handler reads them by reference at press time, so it never needs to
 * re-subscribe as the roster or chats change — only when the path does.
 */
export function useShortcuts(): void {
  const store = useStores()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function run(action: ShortcutAction): boolean {
      const match = AGENT_PATH.exec(location.pathname)

      if (action === "open-palette") {
        store.palette.toggle()
        return true
      }

      if (action === "open-settings") {
        navigate("/settings")
        return true
      }

      if (action === "next-agent" || action === "prev-agent") {
        const members = store.roster.members
        if (members.length === 0) return false
        const delta = action === "next-agent" ? 1 : -1
        const current = members.findIndex((m) => m.id === match?.[1])
        // Not on an agent yet: land on the first (next) or last (previous).
        const next = current === -1 ? 0 : (current + delta + members.length) % members.length
        const target = members[next]
        if (!target) return false
        navigate(`/a/${target.id}`)
        return true
      }

      // The chat actions only make sense while an agent is open.
      const agentId = match?.[1]
      if (!agentId) return false

      if (action === "new-chat") {
        // Mirror the tab strip's "+": open a side chat and jump to it.
        void api.chats.open(agentId).then(
          (created) => {
            void store.chats.loadChats(agentId)
            navigate(`/a/${agentId}/c/${created.id}`)
          },
          () => {},
        )
        return true
      }

      const chats = store.chats.chatsFor(agentId)
      if (chats.length === 0) return false
      const requestedId = match?.[2] ? Number(match[2]) : undefined

      if (action === "close-chat") {
        // Mirror the tab strip's × : only a side chat closes; the main chat
        // "starts over" instead, and cmd-w on it is a no-op. Drop it from the
        // strip and slide to its left neighbour, then close it on the server.
        const active = chatOnShow(chats, requestedId, lastChatId(agentId))
        if (!active || active.kind !== "side") return false
        const landing = chatOnClose(chats, active.id)
        store.chats.dropChat(agentId, active.id)
        store.drafts.clear(active.session)
        navigate(landing ? `/a/${agentId}/c/${landing.id}` : `/a/${agentId}`)
        void api.chats.close(active.id).then(
          () => store.chats.loadChats(agentId),
          () => {},
        )
        return true
      }

      const delta = action === "next-chat" ? 1 : -1
      const current = chats.findIndex((c) => c.id === requestedId)
      const from = current === -1 ? 0 : current
      const next = (from + delta + chats.length) % chats.length
      const target = chats[next]
      if (!target) return false
      navigate(`/a/${agentId}/c/${target.id}`)
      return true
    }

    function onKeyDown(event: KeyboardEvent) {
      const action = store.shortcuts.match(event)
      if (!action) return
      // While the palette is open it owns the keyboard: only its own toggle acts,
      // so cmd-[ / cmd-] and friends don't move the app behind the overlay.
      if (store.palette.isOpen && action !== "open-palette") return
      // Claim the chord before the browser acts on it — cmd-[ / cmd-] are the
      // native back/forward, which we're deliberately overriding.
      if (run(action)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [store, navigate, location.pathname])
}
