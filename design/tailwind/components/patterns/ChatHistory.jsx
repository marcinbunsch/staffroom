import React from "react"

/* Chat history — a list of an agent's past conversations.
   Rows are two-line: title (+ optional branch chip) over a mono meta line.
   Status is a colour channel, not a word in a column: open carries the working
   dot and a blue label, closed is idle grey. Delete stays quiet until the row
   is hovered or the button is focused.

   The persistent thread ("Main") never appears here: it cannot be closed or
   deleted, and this list's only verbs are reopen and delete. Creating a chat
   belongs to ThreadTabs, so there is no footer action. */

function Row({ chat, onOpen, onDelete }) {
  const open = chat.status === "open"
  return (
    <div className="group relative flex items-center gap-3 rounded-row px-2.5 py-[11px] hover:bg-surface-hover">
      <button
        type="button"
        onClick={() => onOpen?.(chat)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left outline-none focus-visible:underline focus-visible:decoration-line-accent focus-visible:decoration-2 focus-visible:underline-offset-4"
      >
        {open ? (
          <span className="relative grid h-[7px] w-[7px] shrink-0 place-items-center">
            <span className="absolute h-[7px] w-[7px] rounded-full bg-status-working animate-pulse-dot" />
          </span>
        ) : (
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-status-idle" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-secondary font-medium text-ink-primary">
              {chat.title}
            </span>
            {chat.branch && (
              <span className="shrink-0 rounded-chip bg-surface-control px-1.5 py-[1px] font-mono text-mono text-ink-monogram">
                {chat.branch}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-mono text-ink-faint">
            <span className={open ? "text-status-working-dim" : "text-ink-label"}>
              {chat.status}
            </span>
            {chat.meta && (
              <>
                <span className="text-ink-label">·</span>
                <span>{chat.meta}</span>
              </>
            )}
          </span>
        </span>
      </button>

      {/* the timestamp yields to the delete button instead of reserving a column */}
      <span className="shrink-0 text-right font-mono text-mono whitespace-nowrap text-ink-faint group-hover:opacity-0">
        {chat.time}
      </span>
      <button
        type="button"
        aria-label={`Delete ${chat.title}`}
        title="Delete this chat"
        onClick={() => onDelete?.(chat)}
        className="absolute right-2.5 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint opacity-0 transition-[color,opacity,background-color] duration-[120ms] ease-out pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-tint-failed hover:text-status-failed-ink focus:pointer-events-auto focus-visible:opacity-100"
      >
        <i className="ti ti-trash text-[15px]" />
      </button>
    </div>
  )
}

export function ChatHistory({ groups = [], onOpen, onDelete, onClose }) {
  const count = groups.reduce((n, g) => n + g.chats.length, 0)
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chat history"
      tabIndex={-1}
      className="flex max-h-[min(620px,calc(100vh-96px))] w-full max-w-[520px] flex-col rounded-panel border border-line-strong bg-surface-card outline-none"
    >
      <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3.5">
        <h2 className="min-w-0 flex-1 font-mono text-label tracking-[0.7px] uppercase text-ink-label">
          Chat history
        </h2>
        <button
          type="button"
          aria-label="Close chat history"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"
        >
          <i className="ti ti-x text-[16px]" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-2.5 pt-4 pb-1.5 first:pt-0">
              <span className="font-mono text-label tracking-[0.7px] uppercase text-ink-label">
                {g.label}
              </span>
            </div>
            {g.chats.map((c) => (
              <Row key={c.id} chat={c} onOpen={onOpen} onDelete={onDelete} />
            ))}
          </div>
        ))}
        {count === 0 && (
          <p className="px-2.5 py-8 text-center text-meta text-ink-faint">No chats yet.</p>
        )}
      </div>
    </div>
  )
}
