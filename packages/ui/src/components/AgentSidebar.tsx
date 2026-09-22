import { observer } from "mobx-react-lite"
import { type ReactNode, useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { StatusDot } from "../design/index.ts"
import { type FileRow, api } from "../lib/api.ts"
import { isTextFile } from "../lib/files.ts"
import { timeAgo } from "../lib/format.ts"
import { describeSchedule } from "../lib/schedule.ts"
import { jobStatus } from "../lib/status.ts"
import { useStores } from "../stores/context.tsx"
import { ConfirmDialog } from "./ConfirmDialog.tsx"
import { FileViewButton } from "./FileViewer.tsx"

const SIDEBAR_ITEM_LIMIT = 8

/**
 * The context rail beside a chat — the prototype's AgentSidebar. On desktop it's
 * a static third column; on mobile a slide-in sheet over the thread. It gathers
 * what an agent is doing that isn't in the transcript: its current job, its
 * schedules, recent jobs, and the files attached to it. Files come from the chat
 * (which already loads them for message chips); jobs and schedules are polled.
 */
export const AgentSidebar = observer(function AgentSidebar({
  agent,
  files,
  onFileChanged,
  open,
  onClose,
}: {
  agent: string
  files: FileRow[]
  onFileChanged: () => void
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  // Jobs and schedules come from the shared stores, kept live by the operator
  // stream; the rail just filters them to this agent.
  const store = useStores()
  useEffect(() => {
    void store.jobs.load()
    void store.schedules.load()
  }, [store])
  const jobs = store.jobs.jobs.filter((job) => job.assigneeAgent === agent)
  const schedules = store.schedules.schedules.filter((schedule) => schedule.agent === agent)

  const recentJobs = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const working = recentJobs.find((job) => jobStatus(job.state) === "working")
  const empty = !working && schedules.length === 0 && jobs.length === 0 && files.length === 0

  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/45 desktop:hidden" onClick={onClose} />}
      <aside
        className={`${
          open ? "fixed inset-y-0 right-0 z-30 flex w-[336px] max-w-[85vw]" : "hidden"
        } min-h-0 flex-col gap-[26px] overflow-y-auto border-l border-line-strong bg-surface-rail-alt px-[22px] pt-6 pb-6 desktop:static desktop:z-auto desktop:flex desktop:w-auto desktop:max-w-none desktop:flex-[0_0_300px]`}
      >
        <div className="flex items-center gap-2 desktop:hidden">
          <div className="font-mono text-label uppercase tracking-[0.7px] text-ink-label">
            Context
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close context"
            className="ml-auto grid h-8 w-8 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
          >
            <i className="ti ti-x text-[16px]" />
          </button>
        </div>

        {empty && (
          <div className="grid flex-1 place-items-center px-4 text-center text-balance text-secondary text-ink-faint">
            Nothing here yet. Work, schedules, and files show up as this agent picks them up.
          </div>
        )}

        {working && (
          <Panel label="Current work">
            <button
              type="button"
              onClick={() => navigate(`/jobs/${working.id}`)}
              className="w-full cursor-pointer rounded-panel border border-line-default bg-surface-card p-3.5 text-left transition-colors duration-[120ms] ease-out hover:border-line-accent"
            >
              <div className="flex items-center gap-2">
                <StatusDot status="working" />
                <span className="min-w-0 truncate text-secondary font-medium text-ink-primary">
                  {working.title}
                </span>
              </div>
              <div className="mt-[9px] font-mono text-mono text-ink-faint">
                #{working.id} · {timeAgo(working.createdAt)}
              </div>
            </button>
          </Panel>
        )}

        {schedules.length > 0 && (
          <Panel label="Schedules" onLabelClick={() => navigate("/schedules")}>
            <div className="flex flex-col gap-2">
              {schedules.map((schedule) => (
                <div key={schedule.id} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-secondary text-ink-secondary">
                    {schedule.title}
                  </span>
                  <span className="font-mono text-mono whitespace-nowrap text-ink-faint">
                    {describeSchedule(schedule.timing)}
                    {schedule.completedAt ? " · done" : schedule.enabled ? "" : " · off"}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {jobs.length > 0 && (
          <Panel label="Recent jobs" onLabelClick={() => navigate("/jobs")}>
            <div className="flex flex-col">
              {recentJobs.slice(0, SIDEBAR_ITEM_LIMIT).map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => navigate(`/jobs/${job.id}`)}
                  title={job.title}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-line-subtle px-0.5 py-[11px] text-left last:border-b-0"
                >
                  <StatusDot status={jobStatus(job.state)} />
                  <span className="min-w-0 flex-1 truncate text-secondary text-ink-secondary">
                    #{job.id} {job.title}
                  </span>
                  <span className="font-mono text-mono whitespace-nowrap text-ink-label">
                    {timeAgo(job.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </Panel>
        )}

        {files.length > 0 && (
          <Panel label="Files">
            <div className="flex flex-col gap-2">
              {files.slice(0, SIDEBAR_ITEM_LIMIT).map((file) => (
                <SidebarFile key={file.id} file={file} onDeleted={onFileChanged} />
              ))}
            </div>
          </Panel>
        )}
      </aside>
    </>
  )
})

function Panel({
  label,
  onLabelClick,
  children,
}: {
  label: string
  onLabelClick?: () => void
  children: ReactNode
}) {
  return (
    <section>
      <div
        onClick={onLabelClick}
        className={`font-mono text-label uppercase tracking-[0.7px] text-ink-label ${
          onLabelClick ? "cursor-pointer hover:text-ink-primary" : ""
        }`}
      >
        {label}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** One file in the rail: click to download; the × deletes it (with a confirm). */
function SidebarFile({ file, onDeleted }: { file: FileRow; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  async function remove() {
    await api.files.remove(file.id)
    onDeleted()
  }
  return (
    <div className="flex items-center gap-[11px] rounded-row border border-line-inset bg-surface-card-hover px-3 py-[11px]">
      <a
        href={api.files.contentUrl(file.id)}
        title={`Download ${file.name}`}
        className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-monogram bg-surface-control font-mono text-[9px] text-ink-monogram no-underline"
      >
        {fileType(file.name)}
      </a>
      <a
        href={api.files.contentUrl(file.id)}
        title={`Download ${file.name}`}
        className="min-w-0 flex-1 text-secondary no-underline"
      >
        <div className="truncate text-ink-secondary">{file.name}</div>
        <div className="mt-0.5 font-mono text-mono text-ink-faint">{timeAgo(file.createdAt)}</div>
      </a>
      {isTextFile(file) && (
        <FileViewButton
          file={file}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-control border-0 bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        />
      )}
      <button
        type="button"
        aria-label={`Delete ${file.name}`}
        title="Delete file"
        onClick={() => setConfirming(true)}
        className="shrink-0 text-ink-muted hover:text-status-failed"
      >
        <i className="ti ti-x text-[14px]" />
      </button>
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirming(false)}
          title={`Delete “${file.name}”?`}
          description="Its content is removed for good. This cannot be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
          pendingLabel="Deleting…"
          onConfirm={remove}
        />
      )}
    </div>
  )
}

/** A three-letter type tag for a file's monogram, from its extension. */
function fileType(name: string): string {
  const extension = name.split(".").pop()?.toUpperCase() ?? ""
  return extension.slice(0, 3) || "FILE"
}
