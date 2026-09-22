import { useCallback, useEffect, useState } from "react"
import { CHAT_HISTORY_PAGE } from "@staffroom/protocol"
import { type ChatRow, api } from "../lib/api.ts"
import { useStores } from "../stores/context.tsx"

/**
 * The history dialog: every chat except the live main — chats you closed and
 * threads you started over. Reopen one (it comes back as a side chat) or delete
 * it for good. Deleting drops the row; the conversation itself stays in the
 * store, just unreachable.
 */
export function ChatHistory({
  agent,
  onOpen,
  onDismiss,
  onChanged,
}: {
  agent: string
  onOpen: (chat: ChatRow) => void
  onDismiss: () => void
  onChanged?: () => void
}) {
  const { drafts } = useStores()
  const [chats, setChats] = useState<ChatRow[]>([])
  const [total, setTotal] = useState(0)
  const [confirming, setConfirming] = useState<number | undefined>()

  const load = useCallback(() => {
    api.chats.history(agent, CHAT_HISTORY_PAGE, 0).then(
      (page) => {
        setChats(page.chats)
        setTotal(page.total)
      },
      () => setChats([]),
    )
  }, [agent])
  useEffect(() => load(), [load])

  async function loadMore() {
    const page = await api.chats.history(agent, CHAT_HISTORY_PAGE, chats.length)
    setChats((current) => [...current, ...page.chats])
    setTotal(page.total)
  }

  async function remove(chat: ChatRow) {
    await api.chats.remove(chat.id)
    drafts.clear(chat.session)
    setChats((current) => current.filter((c) => c.id !== chat.id))
    setTotal((t) => Math.max(0, t - 1))
    setConfirming(undefined)
    onChanged?.() // refresh the tab strip's history count
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-card border border-line-strong bg-surface-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Chat history"
      >
        <div className="flex items-center gap-2 border-b border-line-default px-4 py-3">
          <h2 className="font-semibold text-ink-primary">History</h2>
          <span className="text-meta text-ink-faint">{total}</span>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto text-ink-muted hover:text-ink-primary"
            aria-label="Close"
          >
            <i className="ti ti-x" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {chats.length === 0 && (
            <p className="px-2 py-6 text-center text-secondary text-ink-faint">
              Nothing yet. Chats you close, and threads you start over, land here.
            </p>
          )}
          {chats.map((chat) => (
            <div
              key={chat.id}
              className="group flex items-center gap-2 rounded-control px-2 py-2 hover:bg-surface-hover"
            >
              <button
                type="button"
                onClick={() => onOpen(chat)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate text-secondary text-ink-body">{chat.title}</span>
                  {chat.kind === "main" && (
                    <span className="flex-none rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
                      main
                    </span>
                  )}
                </span>
                <span className="block text-meta text-ink-faint">
                  {formatWhen(chat.lastMessageAt ?? chat.createdAt)}
                </span>
              </button>
              {confirming === chat.id ? (
                <span className="flex flex-none items-center gap-1.5 text-meta">
                  <button
                    type="button"
                    onClick={() => remove(chat)}
                    className="text-status-failed hover:underline"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(undefined)}
                    className="text-ink-muted hover:text-ink-body"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label="Delete chat"
                  title="Delete permanently"
                  onClick={() => setConfirming(chat.id)}
                  className="flex-none opacity-0 group-hover:opacity-100 text-ink-muted hover:text-status-failed"
                >
                  <i className="ti ti-trash text-[15px]" />
                </button>
              )}
            </div>
          ))}
          {chats.length < total && (
            <button
              type="button"
              onClick={loadMore}
              className="mx-auto mt-2 block rounded-control px-3 py-1.5 text-meta text-ink-muted hover:bg-surface-hover hover:text-ink-body"
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}
