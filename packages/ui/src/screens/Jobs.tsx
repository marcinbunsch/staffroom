import { observer } from "mobx-react-lite"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { Button, Pager, SectionHeader, StatusDot } from "../design/index.ts"
import { type JobRow } from "../lib/api.ts"
import { timeAgo } from "../lib/format.ts"
import { jobStateLabel, jobStatus } from "../lib/status.ts"
import { useStores } from "../stores/context.tsx"

const TERMINAL = new Set(["done", "failed", "cancelled"])
const WEEK_MS = 7 * 86_400_000
const RECENT_PAGE_SIZE = 5
const SELECT_CLASS =
  "appearance-none rounded-control border border-line-strong bg-surface-card px-3 py-[7px] text-secondary text-ink-secondary outline-none hover:bg-surface-control"

/**
 * The board: open jobs plus anything done in the last 7 days, filterable by
 * agent and by state, grouped exceptions-first — Needs you, then Working now,
 * then Recent. The Recent tail can run long, so it pages.
 *
 * Ported from the prototype's JobsView. Two v2 rules from the plan's M13 note:
 * the board is **top-level only** so spawned children don't clutter it (they
 * live on their parent's page), but **Working now includes children**, so a job
 * in flight is never invisible.
 */
export const Jobs = observer(function Jobs() {
  const navigate = useNavigate()
  // The board comes from the shared store, kept live by the operator stream's
  // `job.state.changed` — loaded on mount, no timer.
  const store = useStores()
  const jobs = store.jobs.jobs
  const roster = store.roster.members
  const [agent, setAgent] = useState("")
  const [state, setState] = useState("")
  const [recentPage, setRecentPage] = useState(0)
  const [reloading, setReloading] = useState(false)

  useEffect(() => void store.jobs.load(), [store])

  async function reload() {
    setReloading(true)
    try {
      await store.jobs.load()
    } finally {
      setReloading(false)
    }
  }

  // Everything in the board's window for this agent — before the state filter,
  // so the state dropdown only lists states you could actually see.
  const inWindow = jobs
    .filter(
      (job) => !TERMINAL.has(job.state) || Date.now() - new Date(job.updatedAt).getTime() < WEEK_MS,
    )
    .filter((job) => !agent || job.assigneeAgent === agent)
  const states = [...new Set(inWindow.map((job) => job.state))]

  const visible = inWindow.filter((job) => !state || job.state === state)
  const topLevel = visible.filter((job) => job.parentId === null)
  // Working now is the "currently running" view — children included, so a
  // spawned job in flight shows here even though it is not on the top-level list.
  const needsYou = topLevel.filter((job) => job.state === "paused" || job.state === "failed")
  const working = visible.filter((job) => !TERMINAL.has(job.state) && job.state !== "paused")
  const recent = topLevel.filter((job) => job.state === "done" || job.state === "cancelled")

  const open = (job: JobRow) => navigate(`/jobs/${job.id}`)

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-7">
      <div className="mx-auto flex w-full max-w-content flex-col gap-9">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="self-start text-title font-semibold tracking-[-0.3px]">Jobs</h1>
          <span className="text-secondary text-ink-meta">open · done in last 7 days</span>
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <select
              value={agent}
              onChange={(event) => setAgent(event.target.value)}
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
              value={state}
              onChange={(event) => setState(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">All states</option>
              {states.map((value) => (
                <option key={value} value={value}>
                  {jobStateLabel(value)}
                </option>
              ))}
            </select>
            <Button variant="secondary" disabled={reloading} onClick={() => void reload()}>
              {reloading ? "Reloading…" : "Reload"}
            </Button>
          </div>
        </header>

        {visible.length === 0 && <div className="text-secondary text-ink-muted">No jobs.</div>}

        <Group tone="attention" label="Needs you" jobs={needsYou} onOpen={open} />
        <Group tone="working" label="Working now" jobs={working} onOpen={open} />
        <Group
          tone="neutral"
          label="Recent"
          jobs={recent}
          onOpen={open}
          page={recentPage}
          onPage={setRecentPage}
        />
      </div>
    </div>
  )
})

function Group({
  tone,
  label,
  jobs,
  onOpen,
  page,
  onPage,
}: {
  tone: "attention" | "working" | "neutral"
  label: string
  jobs: JobRow[]
  onOpen: (job: JobRow) => void
  /** When set, page the list in RECENT_PAGE_SIZE chunks — for the long Recent tail. */
  page?: number
  onPage?: (page: number) => void
}) {
  if (jobs.length === 0) return null
  const agents = new Set(jobs.map((job) => job.assigneeAgent)).size
  const paged = page !== undefined && onPage !== undefined
  const pageCount = paged ? Math.ceil(jobs.length / RECENT_PAGE_SIZE) : 1
  const start = paged ? page * RECENT_PAGE_SIZE : 0
  const shown = paged ? jobs.slice(start, start + RECENT_PAGE_SIZE) : jobs
  const rangeLabel =
    shown.length < jobs.length
      ? `${start + 1}–${start + shown.length} of ${jobs.length}`
      : `${jobs.length}`
  const meta = tone === "working" ? `${jobs.length} jobs · ${agents} agents` : rangeLabel
  return (
    <section>
      <SectionHeader tone={tone} meta={meta}>
        {label}
      </SectionHeader>
      <div className="mt-4 flex flex-col gap-2.5">
        {shown.map((job) => (
          <JobCard key={job.id} job={job} onClick={() => onOpen(job)} />
        ))}
      </div>
      {paged && (
        <div className="mt-4">
          <Pager page={page} pageCount={pageCount} onPage={onPage} />
        </div>
      )}
    </section>
  )
}

function JobCard({ job, onClick }: { job: JobRow; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-card border border-line-default bg-surface-card p-[18px] transition-colors duration-[120ms] ease-out hover:border-line-accent"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-mono text-ink-faint">#{job.id}</span>
        <span className="font-semibold">{job.title}</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-mono text-ink-muted">
          <StatusDot status={jobStatus(job.state)} />
          {jobStateLabel(job.state)}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-mono text-ink-faint">
        <span>{job.assigneeAgent ?? "unassigned"}</span>
        {job.parentId !== null && <span>child of #{job.parentId}</span>}
        <span>{timeAgo(job.createdAt)}</span>
      </div>
    </div>
  )
}
