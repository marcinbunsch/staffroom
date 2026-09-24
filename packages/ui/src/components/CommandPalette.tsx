import classNames from "classnames"
import { observer } from "mobx-react-lite"
import { type Ref, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { FileViewerDialog } from "./FileViewer.tsx"
import { Dialog, DialogContent, DialogTitle } from "../design/index.ts"
import { type FileRow, api } from "../lib/api.ts"
import { isTextFile } from "../lib/files.ts"
import { fuzzyScore } from "../lib/fuzzy.ts"
import { currentTheme, setThemePreference } from "../lib/theme.ts"
import { useStores } from "../stores/context.tsx"

/**
 * The ⌘K command palette: one box to jump anywhere or run a command. It opens
 * over any screen (toggled by the `open-palette` shortcut), and folds together
 * commands (new agent, new chat, navigate, toggle theme), the roster and jobs
 * lists already in the stores, and two server-backed searches — files (full-text)
 * and chats (by title, across every agent). Results are grouped; ↑/↓ move a
 * single selection across the whole list and Enter runs it. Mounted once in the
 * shell.
 *
 * Agents and jobs filter locally against the stores; files and chats are searched
 * on the server (debounced) so a chat is findable without having opened its agent.
 */

/** A group's rank in the list; also the render order of the sections. */
const GROUP_ORDER = ["Commands", "Go to", "Agents", "Jobs", "Chats", "Files"] as const
type Group = (typeof GROUP_ORDER)[number]

/** How many rows a single non-file group contributes, so no group floods the list. */
const PER_GROUP = 6

type Item = {
  key: string
  group: Group
  title: string
  subtitle?: string
  icon: string
  run: () => void
}

const AGENT_PATH = /^\/a\/([^/]+)/

export const CommandPalette = observer(function CommandPalette() {
  const store = useStores()
  const navigate = useNavigate()
  const location = useLocation()
  const palette = store.palette

  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const [fileHits, setFileHits] = useState<Awaited<ReturnType<typeof api.search.query>>>([])
  const [chatHits, setChatHits] = useState<Awaited<ReturnType<typeof api.chats.search>>>([])
  const [viewingFile, setViewingFile] = useState<FileRow>()
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  // Start each opening clean: empty box, first row selected, focus in the input.
  // Radix moves focus to the panel on open, so claim it back on the next frame.
  useEffect(() => {
    if (!palette.isOpen) return
    setQuery("")
    setSelected(0)
    setFileHits([])
    setChatHits([])
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [palette.isOpen])

  // Files and chats have no full store to filter; search both server-side,
  // debounced, only while open and only for a non-empty query.
  useEffect(() => {
    if (!palette.isOpen) return
    const term = query.trim()
    if (!term) {
      setFileHits([])
      setChatHits([])
      return
    }
    const timer = setTimeout(() => {
      api.search.query(term).then(
        (hits) => setFileHits(hits),
        () => setFileHits([]),
      )
      api.chats.search(term).then(
        (hits) => setChatHits(hits),
        () => setChatHits([]),
      )
    }, 200)
    return () => clearTimeout(timer)
  }, [query, palette.isOpen])

  // A new query means a new list; land back on the first row.
  useEffect(() => setSelected(0), [query])

  const close = () => palette.close()
  const go = (path: string) => {
    close()
    navigate(path)
  }
  const openFile = (id: string) => {
    close()
    api.files.get(id).then(
      (file) => {
        if (file.jobId !== null) navigate(`/jobs/${file.jobId}`)
        else if (isTextFile(file)) setViewingFile(file)
        else window.open(api.files.contentUrl(file.id), "_blank")
      },
      () => {},
    )
  }
  const newChat = (agentId: string) => {
    close()
    api.chats.open(agentId).then(
      (created) => {
        void store.chats.loadChats(agentId)
        navigate(`/a/${agentId}/c/${created.id}`)
      },
      () => {},
    )
  }

  const currentAgent = AGENT_PATH.exec(location.pathname)?.[1]
  const trimmed = query.trim()

  // The commands: actions first, then a "go to" for every rail destination.
  const commands: Item[] = [
    {
      key: "cmd:new-agent",
      group: "Commands",
      title: "New agent",
      icon: "ti-user-plus",
      run: () => go("/new-agent"),
    },
    ...(currentAgent
      ? [
          {
            key: "cmd:new-chat",
            group: "Commands" as const,
            title: "New chat",
            subtitle: `with ${store.roster.nameOf(currentAgent)}`,
            icon: "ti-message-plus",
            run: () => newChat(currentAgent),
          },
        ]
      : []),
    {
      key: "cmd:new-schedule",
      group: "Commands",
      title: "New schedule",
      icon: "ti-clock-plus",
      run: () => go("/schedules/new"),
    },
    {
      key: "cmd:settings",
      group: "Commands",
      title: "Open settings",
      icon: "ti-settings",
      run: () => go("/settings"),
    },
    {
      key: "cmd:theme",
      group: "Commands",
      title: "Toggle theme",
      icon: "ti-contrast",
      run: () => {
        close()
        setThemePreference(currentTheme() === "light" ? "dark" : "light")
      },
    },
  ]

  const goTo: Item[] = NAV.map((item) => ({
    key: `nav:${item.to}`,
    group: "Go to",
    title: item.label,
    icon: item.icon,
    run: () => go(item.to),
  }))

  const agents: Item[] = store.roster.members.map((m) => ({
    key: `agent:${m.id}`,
    group: "Agents",
    title: m.name,
    subtitle: m.description || undefined,
    icon: "ti-user",
    run: () => go(`/a/${m.id}`),
  }))

  const jobs: Item[] = store.jobs.jobs.map((j) => ({
    key: `job:${j.id}`,
    group: "Jobs",
    title: j.title,
    subtitle: `#${j.id} · ${j.state}`,
    icon: "ti-checklist",
    run: () => go(`/jobs/${j.id}`),
  }))

  const chats: Item[] = chatHits.map((chat) => ({
    key: `chat:${chat.id}`,
    group: "Chats",
    title: chat.title || "Untitled chat",
    subtitle: store.roster.nameOf(chat.agent),
    icon: "ti-message",
    run: () => go(`/a/${chat.agent}/c/${chat.id}`),
  }))

  const files: Item[] = fileHits.map((hit) => ({
    key: `file:${hit.refId}`,
    group: "Files",
    title: hit.title,
    subtitle: hit.snippet || undefined,
    icon: "ti-file",
    run: () => openFile(hit.refId),
  }))

  // With no query, a short landing list: what you can do and who's on the roster.
  // With a query, the local stores (commands, nav, agents, jobs) ranked here, then
  // chats and files — already matched and ranked by the server — in their groups.
  const visible: Item[] = trimmed
    ? [
        ...rank(trimmed, commands),
        ...rank(trimmed, goTo),
        ...rank(trimmed, agents),
        ...rank(trimmed, jobs),
        ...chats,
        ...files,
      ]
    : [...commands, ...agents.slice(0, PER_GROUP)]

  const sel = Math.min(selected, Math.max(0, visible.length - 1))

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (visible.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setSelected((s) => (Math.min(s, visible.length - 1) + 1) % visible.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setSelected((s) => (Math.min(s, visible.length - 1) - 1 + visible.length) % visible.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      visible[sel]?.run()
    }
  }

  // Keep the selected row in view as arrows walk past the fold.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" })
  }, [sel])

  return (
    <>
      <Dialog open={palette.isOpen} onOpenChange={(open) => !open && close()}>
        {palette.isOpen && (
          <DialogContent size="md">
            <DialogTitle srOnly>Command palette</DialogTitle>
            <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
              <i className="ti ti-search text-[17px] text-ink-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Jump to an agent, job, file… or run a command"
                className="flex-1 bg-transparent py-3.5 text-body text-ink-primary outline-none placeholder:text-ink-muted"
                aria-label="Search commands and destinations"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1.5">
              {visible.length === 0 ? (
                <div className="px-4 py-8 text-center text-secondary text-ink-muted">
                  No matches for "{trimmed}"
                </div>
              ) : (
                visible.map((item, i) => {
                  const first = i === 0 || visible[i - 1]?.group !== item.group
                  return (
                    <div key={item.key}>
                      {first && (
                        <div className="px-4 pt-3 pb-1 font-mono text-label uppercase tracking-[0.7px] text-ink-label">
                          {item.group}
                        </div>
                      )}
                      <Row
                        item={item}
                        active={i === sel}
                        rowRef={i === sel ? selectedRef : undefined}
                        onHover={() => setSelected(i)}
                        onRun={item.run}
                      />
                    </div>
                  )
                })
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-line-subtle px-4 py-2 text-meta text-ink-muted">
              <Hint keys="↑ ↓" label="Navigate" />
              <Hint keys="↵" label="Open" />
              <Hint keys="esc" label="Close" />
            </div>
          </DialogContent>
        )}
      </Dialog>
      <FileViewerDialog file={viewingFile} onClose={() => setViewingFile(undefined)} />
    </>
  )
})

/** Keep only the items whose title/subtitle match, best first. */
function rank(query: string, items: Item[]): Item[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, `${item.title} ${item.subtitle ?? ""}`) }))
    .filter((entry): entry is { item: Item; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, PER_GROUP)
    .map((entry) => entry.item)
}

function Row({
  item,
  active,
  rowRef,
  onHover,
  onRun,
}: {
  item: Item
  active: boolean
  rowRef?: Ref<HTMLButtonElement>
  onHover: () => void
  onRun: () => void
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      // Pointer *movement*, not enter, so opening the palette under the cursor
      // doesn't yank the selection off the first row before a key is pressed.
      onMouseMove={onHover}
      onClick={onRun}
      className={classNames(
        "flex w-full items-center gap-3 px-4 py-2 text-left",
        active ? "bg-surface-selected" : "hover:bg-surface-hover",
      )}
    >
      <i className={`ti ${item.icon} w-[18px] shrink-0 text-center text-[16px] text-ink-muted`} />
      <span className="min-w-0 flex-1 truncate text-secondary text-ink-primary">{item.title}</span>
      {item.subtitle && (
        <span className="min-w-0 max-w-[45%] shrink-0 truncate text-meta text-ink-muted">
          {item.subtitle}
        </span>
      )}
    </button>
  )
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-line-strong bg-surface-card px-1.5 py-0.5 font-mono text-mono text-ink-muted">
        {keys}
      </kbd>
      {label}
    </span>
  )
}

/** The rail's destinations, mirrored so "Go to" reaches every screen. */
const NAV: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Home", icon: "ti-home" },
  { to: "/inbox", label: "Inbox", icon: "ti-inbox" },
  { to: "/dashboards", label: "Dashboards", icon: "ti-layout-dashboard" },
  { to: "/jobs", label: "Jobs", icon: "ti-checklist" },
  { to: "/schedules", label: "Schedules", icon: "ti-clock" },
  { to: "/files", label: "Files", icon: "ti-files" },
  { to: "/memory", label: "Memory", icon: "ti-brain" },
  { to: "/skills", label: "Skills", icon: "ti-sparkles" },
  { to: "/spend", label: "Spend", icon: "ti-coin" },
]
