import { useFlueAgent } from "@flue/react"
import { NEW_CHAT_TITLE, titleFromMessage } from "@staffroom/protocol"
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { AgentSidebar } from "../components/AgentSidebar.tsx"
import { ApprovalCard } from "../components/ApprovalCard.tsx"
import { ChatHistory } from "../components/ChatHistory.tsx"
import { ChatTabs } from "../components/ChatTabs.tsx"
import { Composer } from "../components/Composer.tsx"
import { RequestCard } from "../components/RequestCard.tsx"
import { Transcript } from "../components/Transcript.tsx"
import { Avatar, StatusDot } from "../design/index.ts"
import { type AttentionRow, type FileRow, type StaffRow, type TabChatRow, api } from "../lib/api.ts"
import { buildAttachmentBody } from "../lib/attachments.ts"
import { initials } from "../lib/format.ts"
import { chatOnShow, lastChatId, rememberChat } from "../lib/last-chat.ts"
import { useStores } from "../stores/context.tsx"

/**
 * The chat screen. An agent has multiple conversations — a durable **main** chat
 * plus any number of side chats — shown as a tab strip; each is its own Flue
 * session, so switching tabs builds a fresh client rather than pouring one
 * transcript into another. Closed and started-over chats live in History.
 *
 * `useFlueAgent` points at `/agents/<session>`, a relative same-origin URL, so
 * the better-auth cookie carries automatically and the route's tenant guard
 * applies.
 */
export const Chat = observer(function Chat() {
  const { agentId, chatId } = useParams()
  const navigate = useNavigate()
  // Roster and the tab strip come from the stores; the strip's at-work dots and
  // unread badges move on the operator stream's activity/unread events, not a
  // timer.
  const store = useStores()
  const roster = store.roster.members
  const member = roster.find((row) => row.id === agentId)
  const chats = agentId ? store.chats.chatsFor(agentId) : []
  const historyCount = agentId ? store.chats.historyCountFor(agentId) : 0

  const [showHistory, setShowHistory] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)

  // This agent's files — the attachments sent to it — kept at the agent level so
  // they survive a chat switch and feed both the message chips and the context
  // rail. Reloaded after an upload and after a turn settles (a tool may write one).
  const [files, setFiles] = useState<FileRow[]>([])
  const reloadFiles = useCallback(() => {
    if (!agentId) return
    api.files.list().then(
      (all) => setFiles(all.filter((file) => file.agent === agentId)),
      () => setFiles([]),
    )
  }, [agentId])
  useEffect(() => reloadFiles(), [reloadFiles])
  // The context sheet is per-agent; close it when switching agents.
  useEffect(() => setContextOpen(false), [agentId])

  const reload = useCallback(() => {
    if (agentId) void store.chats.loadChats(agentId)
  }, [agentId, store])
  useEffect(() => reload(), [reload])

  const requestedId = chatId ? Number(chatId) : undefined
  const chat = chatOnShow(chats, requestedId, agentId ? lastChatId(agentId) : undefined)

  // Remember the resolved chat so a bare /a/:agentId reopens it next time.
  useEffect(() => {
    if (agentId && chat) rememberChat(agentId, chat.id)
  }, [agentId, chat])

  // The chat on screen is read: clear its unread whenever a count appears —
  // whether it was already unread on open or a reply just landed while viewing.
  useEffect(() => {
    if (chat && chat.unread > 0) api.chats.markRead(chat.id).then(reload, () => {})
  }, [chat?.id, chat?.unread, reload])

  if (!agentId) return null
  if (chats.length === 0 || !chat) {
    return <div className="grid h-full place-items-center text-secondary text-ink-faint">…</div>
  }

  const select = (target: TabChatRow) => navigate(`/a/${agentId}/c/${target.id}`)

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          member={member}
          agent={agentId}
          name={member?.name ?? agentId}
          working={chat.active}
          onToggleContext={() => setContextOpen((open) => !open)}
        />

        <ChatTabs
          chats={chats}
          activeId={chat.id}
          historyCount={historyCount}
          onSelect={select}
          onNew={async () => {
            const created = await api.chats.open(agentId)
            reload()
            navigate(`/a/${agentId}/c/${created.id}`)
          }}
          onRename={(target, title) => api.chats.rename(target.id, title).then(reload)}
          onClose={async (target) => {
            // Drop it from the strip at once, and if it was the open tab move to
            // the main chat explicitly (not via the now-stale last-viewed id).
            store.chats.dropChat(agentId, target.id)
            store.drafts.clear(target.session)
            if (target.id === chat.id) {
              const main = chats.find((c) => c.kind === "main")
              navigate(main ? `/a/${agentId}/c/${main.id}` : `/a/${agentId}`)
            }
            await api.chats.close(target.id)
            reload()
          }}
          onClearMain={async () => {
            // The old main thread is wiped, so its draft goes with it.
            const oldMain = chats.find((c) => c.kind === "main")
            if (oldMain) store.drafts.clear(oldMain.session)
            const fresh = await api.chats.clearMain(agentId)
            reload()
            navigate(`/a/${agentId}/c/${fresh.id}`)
          }}
          onShowHistory={() => setShowHistory(true)}
        />

        <ChatThread
          key={chat.session}
          chat={chat}
          agent={agentId}
          roster={roster}
          files={files}
          onChatsChanged={reload}
          onFilesChanged={reloadFiles}
        />

        {showHistory && (
          <ChatHistory
            agent={agentId}
            onDismiss={() => setShowHistory(false)}
            onChanged={reload}
            onOpen={async (target) => {
              await api.chats.reopen(target.id)
              reload()
              setShowHistory(false)
              navigate(`/a/${agentId}/c/${target.id}`)
            }}
          />
        )}
      </div>

      <AgentSidebar
        agent={agentId}
        files={files}
        onFileChanged={reloadFiles}
        open={contextOpen}
        onClose={() => setContextOpen(false)}
      />
    </div>
  )
})

function Header({
  member,
  agent,
  name,
  working,
  onToggleContext,
}: {
  member?: StaffRow
  agent: string
  name: string
  working: boolean
  onToggleContext: () => void
}) {
  const monogram = initials(name)
  return (
    <header className="flex items-center gap-3 border-b border-line-default px-5 py-3">
      <Avatar
        initials={monogram}
        size="lg"
        status={working ? "working" : undefined}
        ringColor="var(--surface-canvas)"
      />
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
          {name}
          {working && <StatusDot status="working" ring />}
        </h1>
        {member?.systemPrompt && (
          <p className="line-clamp-1 text-xs text-ink-muted" title={member.systemPrompt}>
            {member.systemPrompt}
          </p>
        )}
      </div>
      <Link
        to={`/a/${agent}/board`}
        title="Board"
        aria-label="Board"
        className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
      >
        <i className="ti ti-layout-dashboard text-[17px]" />
      </Link>
      <Link
        to={`/a/${agent}/edit`}
        title="Edit agent"
        aria-label="Edit agent"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
      >
        <i className="ti ti-settings text-[17px]" />
      </Link>
      {/* The context rail is a sheet on mobile; this opens it. On desktop the
          rail is always shown, so the button is hidden. */}
      <button
        type="button"
        onClick={onToggleContext}
        title="Show context"
        aria-label="Show context"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary desktop:hidden"
      >
        <i className="ti ti-layout-sidebar-right text-[17px]" />
      </button>
    </header>
  )
}

const ChatThread = observer(function ChatThread({
  chat,
  agent,
  roster,
  files,
  onChatsChanged,
  onFilesChanged,
}: {
  chat: TabChatRow
  agent: string
  roster: StaffRow[]
  files: FileRow[]
  onChatsChanged: () => void
  onFilesChanged: () => void
}) {
  const store = useStores()
  const url = useMemo(() => `/agents/${chat.session}`, [chat.session])
  const conversation = useFlueAgent({ url })
  const { status, sendMessage, refresh } = conversation
  const working = status === "submitted" || status === "streaming"
  const monogram = initials(agent)
  const name = roster.find((row) => row.id === agent)?.name ?? agent
  const mentions = useMemo(() => roster.map((row) => ({ id: row.id, name: row.name })), [roster])

  // A tool may write a file mid-turn; refresh the agent's files once it settles.
  useEffect(() => {
    if (!working) onFilesChanged()
  }, [working, onFilesChanged])

  // The pending approvals/requests raised in *this* chat — matched by session,
  // not just agent, so a gate tripped in one of an agent's chats does not show
  // on all of them. (Job-raised items carry a job session and live on the job
  // page instead.) Kept live by the operator stream — no per-thread poll.
  const pending = store.attention.items.filter((item) => item.session === chat.session)

  // Upload first, then send: a failed upload throws before the message goes, so a
  // message never leaves with a missing attachment. On success the reference
  // block rides in the body — the only channel to the agent — naming each id.
  async function send(text: string, selected: File[]) {
    // Name a still-unnamed side chat after its first message (a substring, no
    // model call), so a "New chat" tab gets a real title as soon as it is used.
    if (chat.kind === "side" && chat.title === NEW_CHAT_TITLE) {
      api.chats.rename(chat.id, titleFromMessage(text)).then(onChatsChanged, () => {})
    }
    if (selected.length === 0) {
      await sendMessage(text)
      return
    }
    const uploaded: FileRow[] = []
    for (const file of selected) uploaded.push((await api.files.upload(file, { agent })).file)
    await sendMessage(buildAttachmentBody(text, uploaded))
    onFilesChanged()
  }

  // Answering resolves it in the shared store (optimistic drop, stream
  // reconciles) and refreshes the transcript, since the answer resumes the turn.
  async function answer(item: AttentionRow, decision: "approved" | "denied", reason?: string) {
    await store.attention.answer(item, decision, reason)
    refresh()
  }

  async function resolve(item: AttentionRow, note?: string) {
    await store.attention.resolve(item, note)
    refresh()
  }

  async function dismiss(item: AttentionRow, note: string) {
    await store.attention.dismiss(item, note)
    refresh()
  }

  return (
    <>
      <Transcript
        conversation={conversation}
        agent={agent}
        agentInitials={monogram}
        files={files}
      />

      {pending.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line-default px-5 py-3">
          {pending.map((item) =>
            item.kind === "approval" ? (
              <ApprovalCard key={item.id} item={item} onAnswer={answer} />
            ) : (
              <RequestCard key={item.id} item={item} onResolve={resolve} onDismiss={dismiss} />
            ),
          )}
        </div>
      )}

      <div className="px-5 pt-2 pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
        <Composer
          key={chat.id}
          placeholder={`Message ${name}`}
          onSend={send}
          autoFocus
          allowAttachments
          mentions={mentions}
          draftKey={chat.session}
        />
      </div>
    </>
  )
})
