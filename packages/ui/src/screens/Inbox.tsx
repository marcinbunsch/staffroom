import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { useNavigate } from "react-router"
import { Avatar, Button, SectionHeader, UnreadBadge } from "../design/index.ts"
import { type TabChatRow } from "../lib/api.ts"
import { initials, timeAgo } from "../lib/format.ts"
import { useStores } from "../stores/context.tsx"

/**
 * The inbox: every conversation across every agent, in one list, so "which chat
 * do I jump into next?" has one answer. Unread replies pin to the top; the rest
 * follow by the agent's latest reply, so a thread that goes quiet simply sinks.
 * A row opens its chat (which marks it read); archiving closes the chat, moving
 * it to that agent's history.
 *
 * The list is the shared `InboxStore`, loaded on first open and kept live by
 * the operator stream's unread/activity pulses — no timer.
 */
export const Inbox = observer(function Inbox() {
  const store = useStores()
  const navigate = useNavigate()
  const inbox = store.inbox
  useEffect(() => void inbox.load(), [inbox])

  const unread = inbox.chats.filter((chat) => chat.unread > 0)
  const earlier = inbox.chats.filter((chat) => chat.unread === 0)
  const open = (chat: TabChatRow) => navigate(`/a/${chat.agent}/c/${chat.id}`)

  const row = (chat: TabChatRow) => (
    <InboxRow
      key={chat.id}
      chat={chat}
      agentName={store.roster.nameOf(chat.agent)}
      onOpen={open}
      onMarkRead={inbox.markRead}
      onArchive={inbox.archive}
    />
  )

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-[calc(1.75rem_+_env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-content flex-col gap-9">
        <header className="flex flex-col gap-1">
          <h1 className="text-title font-semibold tracking-[-0.3px]">Inbox</h1>
          <p className="text-secondary text-ink-muted">
            Every conversation, newest reply first
            {unread.length > 0 && ` · ${unread.length} unread`}
          </p>
        </header>

        {inbox.loaded && inbox.chats.length === 0 && (
          <div className="rounded-card border border-line-default bg-surface-card px-5 py-8 text-center">
            <div className="text-body font-medium text-ink-primary">No conversations yet</div>
            <div className="mt-1 text-secondary text-ink-muted">
              When an agent replies in any chat, it shows up here.
            </div>
          </div>
        )}

        {unread.length > 0 && (
          <section>
            <SectionHeader tone="attention" meta={`${unread.length}`}>
              Unread
            </SectionHeader>
            <div className="mt-4 flex flex-col gap-2">{unread.map(row)}</div>
          </section>
        )}

        {earlier.length > 0 && (
          <section>
            <SectionHeader meta={`${inbox.total - unread.length}`}>
              {unread.length > 0 ? "Earlier" : "Conversations"}
            </SectionHeader>
            <div className="mt-4 flex flex-col gap-2">{earlier.map(row)}</div>
            {inbox.chats.length < inbox.total && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" onClick={() => void inbox.loadMore()}>
                  Show more
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
})

/**
 * One conversation: who, which chat, what they last said, when. An unread row
 * is weighted and badged; one the agent is working in right now carries the
 * working dot. Mark-read and archive sit on the right, revealed on hover (and
 * always shown on touch, where there is no hover).
 */
function InboxRow({
  chat,
  agentName,
  onOpen,
  onMarkRead,
  onArchive,
}: {
  chat: TabChatRow
  agentName: string
  onOpen: (chat: TabChatRow) => void
  onMarkRead: (chat: TabChatRow) => Promise<void>
  onArchive: (chat: TabChatRow) => Promise<void>
}) {
  const isUnread = chat.unread > 0
  return (
    <div
      className={`group flex items-start gap-3 rounded-row border px-3 py-2.5 transition-colors duration-[120ms] ease-out hover:border-line-accent ${
        isUnread ? "border-line-inset bg-surface-card-hover" : "border-line-default bg-surface-card"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(chat)}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left"
      >
        <span className="pt-0.5">
          <Avatar
            initials={initials(agentName)}
            size="md"
            status={chat.active ? "working" : undefined}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={`truncate text-secondary ${
                isUnread ? "font-semibold text-ink-primary" : "text-ink-body"
              }`}
            >
              {agentName}
            </span>
            <span className="truncate text-secondary text-ink-muted">
              {chat.kind === "main" ? "main chat" : chat.title}
            </span>
            <span className="ml-auto flex-none font-mono text-mono text-ink-faint">
              {chat.active ? "working…" : chat.lastMessageAt ? timeAgo(chat.lastMessageAt) : ""}
            </span>
          </span>
          {chat.lastPreview && (
            <span
              className={`mt-0.5 line-clamp-2 text-secondary ${
                isUnread ? "text-ink-body" : "text-ink-muted"
              }`}
            >
              {chat.lastPreview}
            </span>
          )}
        </span>
      </button>
      <span className="flex flex-none items-center gap-2 self-center">
        <UnreadBadge count={chat.unread} />
        {isUnread && (
          <RowAction icon="ti-mail-opened" label="Mark read" onClick={() => onMarkRead(chat)} />
        )}
        {chat.kind !== "main" && (
          <RowAction icon="ti-archive" label="Archive" onClick={() => onArchive(chat)} />
        )}
      </span>
    </div>
  )
}

function RowAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="cursor-pointer text-ink-muted opacity-100 hover:text-ink-primary md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
    >
      <i className={`ti ${icon} text-[15px]`} />
    </button>
  )
}
