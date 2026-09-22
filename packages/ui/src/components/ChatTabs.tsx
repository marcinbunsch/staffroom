import { useEffect, useRef, useState } from "react"
import type { TabChatRow } from "../lib/api.ts"
import { ConfirmDialog } from "./ConfirmDialog.tsx"

/**
 * The tab strip under the chat header: every open chat, main first. A dot shows
 * each tab's live state (at work / unread / idle). "+" opens a side chat;
 * double-click renames in place; a side tab closes with ×, the main tab starts
 * over. The "History" button opens the closed-chats dialog.
 */
export function ChatTabs({
  chats,
  activeId,
  historyCount,
  onSelect,
  onNew,
  onRename,
  onClose,
  onClearMain,
  onShowHistory,
}: {
  chats: TabChatRow[]
  activeId: number | undefined
  historyCount: number
  onSelect: (chat: TabChatRow) => void
  onNew: () => void
  onRename: (chat: TabChatRow, title: string) => void
  onClose: (chat: TabChatRow) => void
  onClearMain: () => void
  onShowHistory: () => void
}) {
  const [editing, setEditing] = useState<number | undefined>()
  const [confirmingClear, setConfirmingClear] = useState(false)

  return (
    <div className="flex items-center gap-1 border-b border-line-default px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {chats.map((chat) => {
          const active = chat.id === activeId
          return (
            <div
              key={chat.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              onClick={() => {
                if (editing !== chat.id) onSelect(chat)
              }}
              onDoubleClick={() => {
                if (editing !== chat.id) setEditing(chat.id)
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || editing === chat.id) return
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelect(chat)
                }
              }}
              className={`group flex flex-none cursor-pointer items-center gap-1.5 rounded-control px-2.5 py-1 text-secondary ${
                active
                  ? "bg-surface-selected text-ink-primary"
                  : "text-ink-muted hover:bg-surface-hover"
              }`}
            >
              <TabDot chat={chat} active={active} />
              {editing === chat.id ? (
                <TabName
                  initial={chat.title}
                  onCommit={(title) => {
                    if (title && title !== chat.title) onRename(chat, title)
                    setEditing(undefined)
                  }}
                  onCancel={() => setEditing(undefined)}
                />
              ) : (
                <span className="max-w-[160px] truncate" title={chat.title}>
                  {chat.title}
                </span>
              )}
              {chat.kind === "side" ? (
                <button
                  type="button"
                  aria-label="Close chat"
                  title="Close chat"
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(chat)
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-ink-primary"
                >
                  <i className="ti ti-x text-[13px]" />
                </button>
              ) : (
                active && (
                  <button
                    type="button"
                    aria-label="Start over"
                    title="Start over — closes this chat and opens a fresh one"
                    onClick={(event) => {
                      event.stopPropagation()
                      setConfirmingClear(true)
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-ink-primary"
                  >
                    <i className="ti ti-refresh text-[13px]" />
                  </button>
                )
              )}
            </div>
          )
        })}

        <button
          type="button"
          aria-label="New chat"
          title="New chat"
          onClick={onNew}
          className="flex-none rounded-control px-1.5 py-1 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        >
          <i className="ti ti-plus text-[15px]" />
        </button>
      </div>

      {historyCount > 0 && (
        <button
          type="button"
          onClick={onShowHistory}
          className="flex-none rounded-control px-2 py-1 text-meta text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        >
          <i className="ti ti-history text-[14px]" /> History
          <span className="ml-1 font-mono text-label text-ink-faint">{historyCount}</span>
        </button>
      )}

      {confirmingClear && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmingClear}
          title="Start over?"
          description="This closes the current chat and opens a fresh one. The existing thread moves to History."
          confirmLabel="Start over"
          confirmVariant="danger"
          onConfirm={onClearMain}
        />
      )}
    </div>
  )
}

/** The per-tab status dot: at work (pulsing), unread (amber), or idle. */
function TabDot({ chat, active }: { chat: TabChatRow; active: boolean }) {
  if (chat.active) {
    return <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-status-working" />
  }
  if (chat.unread > 0 && !active) {
    return <span className="h-1.5 w-1.5 flex-none rounded-full bg-status-attention" />
  }
  return <span className="h-1.5 w-1.5 flex-none rounded-full bg-transparent" />
}

/** Inline rename input for a tab. */
function TabName({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value.trim())
        if (e.key === "Escape") onCancel()
      }}
      maxLength={60}
      className="w-[160px] rounded-control border border-line-strong bg-surface-inset px-1.5 py-0.5 text-secondary text-ink-body"
    />
  )
}
