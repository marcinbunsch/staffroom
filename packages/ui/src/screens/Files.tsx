import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { FILES_PAGE } from "@staffroom/protocol"
import { ConfirmDialog } from "../components/ConfirmDialog.tsx"
import { FileViewerDialog } from "../components/FileViewer.tsx"
import { ArtifactRow, Button, Pager } from "../design/index.ts"
import { type FileRow, type StaffRow, api } from "../lib/api.ts"
import { isTextFile } from "../lib/files.ts"
import { fileSize, timeAgo } from "../lib/format.ts"

type Filter = "all" | "operator" | "artifacts" | "org"

const SELECT_CLASS =
  "appearance-none rounded-control border border-line-strong bg-surface-card px-3 py-[7px] text-secondary text-ink-secondary outline-none hover:bg-surface-control"

/**
 * The shared space: every file the team holds — operator uploads and
 * agent artifacts/job output, one store — with who made it, its size, and where it came
 * from. Ported from the prototype's ArtifactsView and widened to v2's unified
 * file model: a `source`, and a `visibility` you flip to share a file with the
 * whole organization or pull it back to private.
 *
 * Search is the primary way to find a file: the box runs full-text search
 * server-side, and the Topics chips and the selects refine the same list. The
 * filtering, sorting, and paging run server-side (`GET /api/files/page` returns
 * `{ files, total, labels }` for one page), so a large history pages instead of
 * loading whole. Changing a filter, the search, or the sort resets to the first
 * page; `labels` is the recurring, human topics across all visible files — the
 * Topics bar stays complete on any page without drowning in one-off tags.
 */
export function Files({ roster }: { roster: StaffRow[] }) {
  const navigate = useNavigate()
  const [files, setFiles] = useState<FileRow[]>([])
  const [total, setTotal] = useState(0)
  const [allLabels, setAllLabels] = useState<string[]>([])
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [agent, setAgent] = useState("")
  const [label, setLabel] = useState("")
  // `search` is the live input; `q` is the debounced value that hits the server,
  // so typing doesn't fire a request per keystroke.
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<"recent" | "name">("recent")
  const [viewing, setViewing] = useState<FileRow>()
  const [deleting, setDeleting] = useState<FileRow>()
  const [editing, setEditing] = useState<{ id: string; text: string }>()
  const [error, setError] = useState<string>()
  const uploadInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    setBusy(true)
    api.files
      .page({ limit: FILES_PAGE, offset: page * FILES_PAGE, filter, agent, label, q, sort })
      .then(
        (res) => {
          setFiles(res.files)
          setTotal(res.total)
          setAllLabels(res.labels)
          // Deleting the last row on the last page can leave us past the end;
          // fall back to the last page that still has rows.
          const lastPage = Math.max(0, Math.ceil(res.total / FILES_PAGE) - 1)
          if (page > lastPage) setPage(lastPage)
        },
        () => {
          setFiles([])
          setTotal(0)
          setAllLabels([])
        },
      )
      .finally(() => setBusy(false))
  }, [page, filter, agent, label, q, sort])
  useEffect(() => reload(), [reload])

  // Debounce the search box, and return to the first page on a new query.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim())
      setPage(0)
    }, 200)
    return () => clearTimeout(timer)
  }, [search])

  // A filter or sort change starts a new result set, so return to the first page.
  const pageCount = Math.ceil(total / FILES_PAGE)
  const changeFilter = (next: Filter) => {
    setFilter(next)
    setPage(0)
  }
  const changeAgent = (next: string) => {
    setAgent(next)
    setPage(0)
  }
  const changeSort = (next: "recent" | "name") => {
    setSort(next)
    setPage(0)
  }
  const toggleLabel = (tag: string) => {
    setLabel((current) => (current === tag ? "" : tag))
    setPage(0)
  }

  const agentName = (id: string | null) =>
    (id && roster.find((member) => member.id === id)?.name) || id || "—"

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(undefined)
    try {
      await api.files.upload(file)
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.")
    } finally {
      if (uploadInput.current) uploadInput.current.value = ""
    }
  }

  async function share(file: FileRow) {
    const next = file.visibility === "org" ? "private" : "org"
    // Sharing can move a file in or out of the "Shared" filter, so re-read the
    // page rather than patch the row in place.
    await api.files.setVisibility(file.id, next)
    reload()
  }

  async function remove(file: FileRow) {
    await api.files.remove(file.id)
    if (viewing?.id === file.id) setViewing(undefined)
    // Refill the page from the server and refresh the total and labels bar.
    reload()
  }

  async function saveLabels(id: string) {
    if (!editing) return
    const labels = editing.text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
    try {
      await api.files.setLabels(id, labels)
      setEditing(undefined)
      // Labels feed both the row and the topics bar, so re-read the page.
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save labels.")
    }
  }

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-7">
      <div className="mx-auto flex w-full max-w-content flex-col gap-6">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="self-start text-title font-semibold tracking-[-0.3px]">Files</h1>
          {total > 0 && <span className="text-secondary text-ink-meta">{total} total</span>}
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search files…"
              className="w-[220px] rounded-control border border-line-strong bg-surface-card px-3 py-[7px] text-secondary outline-none placeholder:text-ink-faint focus:border-line-strong"
            />
            <select
              value={filter}
              onChange={(event) => changeFilter(event.target.value as Filter)}
              className={SELECT_CLASS}
            >
              <option value="all">All files</option>
              <option value="operator">Uploaded</option>
              <option value="artifacts">Artifacts</option>
              <option value="org">Shared</option>
            </select>
            <select
              value={agent}
              onChange={(event) => changeAgent(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">All agents</option>
              {roster.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(event) => changeSort(event.target.value as "recent" | "name")}
              className={SELECT_CLASS}
            >
              <option value="recent">Recent</option>
              <option value="name">Name</option>
            </select>
            <input ref={uploadInput} type="file" className="hidden" onChange={upload} />
            <Button variant="primary" onClick={() => uploadInput.current?.click()}>
              Upload
            </Button>
          </div>
        </header>

        {allLabels.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-mono text-ink-faint">Topics</span>
            {allLabels.map((tag) => {
              const active = label === tag
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleLabel(tag)}
                  className={`rounded-[5px] border px-[7px] py-[3px] font-mono text-label ${
                    active
                      ? "border-transparent bg-tint-attention text-status-attention"
                      : "border-line-strong bg-line-subtle text-ink-muted hover:text-ink-primary"
                  }`}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        )}

        {error && <div className="text-secondary text-status-failed">{error}</div>}

        {files.length === 0 ? (
          <div className="text-secondary text-ink-muted">
            {q
              ? `No files match “${q}”.`
              : filter === "all" && !agent && !label
                ? "No files yet — upload one, or let an agent produce one."
                : "No files match these filters."}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {files.map((file) => (
              <div key={file.id} className="flex flex-col gap-1">
                <ArtifactRow
                  type={fileType(file.name, file.contentType)}
                  name={file.name}
                  meta={metaLine(file, agentName(file.agent))}
                  labels={file.labels}
                  onClick={file.jobId === null ? undefined : () => navigate(`/jobs/${file.jobId}`)}
                  onView={isTextFile(file) ? () => setViewing(file) : undefined}
                  onDownload={() => window.open(api.files.contentUrl(file.id), "_blank")}
                  onShare={() => void share(file)}
                  shared={file.visibility === "org"}
                  onEditLabels={() =>
                    setEditing(
                      editing?.id === file.id
                        ? undefined
                        : { id: file.id, text: file.labels.join(", ") },
                    )
                  }
                  onDelete={() => setDeleting(file)}
                />
                {editing?.id === file.id && (
                  <div className="flex items-center gap-2 rounded-row border border-line-default bg-surface-card px-3 py-2">
                    <input
                      autoFocus
                      value={editing.text}
                      onChange={(event) => setEditing({ id: file.id, text: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveLabels(file.id)
                        if (event.key === "Escape") setEditing(undefined)
                      }}
                      placeholder="Topics, comma-separated — e.g. invoices, onboarding, client-acme"
                      className="flex-1 rounded-control border border-line-strong bg-surface-card px-2.5 py-1.5 text-secondary outline-none"
                    />
                    <Button variant="primary" onClick={() => void saveLabels(file.id)}>
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(undefined)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Pager page={page} pageCount={pageCount} onPage={setPage} busy={busy} />
      </div>
      <FileViewerDialog file={viewing} onClose={() => setViewing(undefined)} />
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setDeleting(undefined)}
          title={`Delete “${deleting.name}”?`}
          description="Its content is removed for good. This cannot be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
          pendingLabel="Deleting…"
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  )
}

function metaLine(file: FileRow, agentName: string): string {
  const where =
    file.source === "operator"
      ? "uploaded"
      : file.source === "agent"
        ? `artifact by ${agentName}${file.jobId === null ? "" : ` · job #${file.jobId}`}`
        : `job #${file.jobId}`
  const shared = file.visibility === "org" ? " · shared" : ""
  return `${where} · ${fileSize(file.size)} · ${timeAgo(file.createdAt)}${shared}`
}

/** Three-letter mono type badge from a filename or content type. */
function fileType(name: string, contentType: string): string {
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : ""
  if (ext) return ext.toUpperCase().slice(0, 3)
  if (contentType.startsWith("image/")) return "IMG"
  if (contentType.startsWith("text/")) return "TXT"
  return "DOC"
}
