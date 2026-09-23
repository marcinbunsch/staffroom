import { useFlueAgent } from "@flue/react"
import { observer } from "mobx-react-lite"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { ApprovalCard } from "../components/ApprovalCard.tsx"
import { Composer } from "../components/Composer.tsx"
import { Markdown } from "../components/Markdown.tsx"
import { RequestCard } from "../components/RequestCard.tsx"
import { Summary } from "../components/Summary.tsx"
import { Transcript } from "../components/Transcript.tsx"
import { Button, SectionHeader, StatusDot, Timeline, TimelineEntry } from "../design/index.ts"
import { type JobDetailRow, type Me, api } from "../lib/api.ts"
import { clock, initials, timeAgo } from "../lib/format.ts"
import { jobEntryState, jobStateLabel, jobStatus } from "../lib/status.ts"
import { useOperatorEvent, useStores } from "../stores/context.tsx"

const TERMINAL = new Set(["done", "failed", "cancelled"])

/**
 * The job workspace: closing summary, operator controls, the live activity of
 * the assignee's job session, the timeline, nested children, and a steer box.
 * Ported from the prototype's JobView, trimmed to v2's API — no artifacts or
 * cost yet, and operator actions are the four the server exposes (pause,
 * resume, restart, steer).
 */
export const Job = observer(function Job({ me }: { me: Me }) {
  const navigate = useNavigate()
  const id = Number(useParams().id)
  // The job's own detail is a single-entity fetch (not a list slice), so it
  // stays local — but it refetches off the operator stream's `job.state.changed`
  // rather than a timer. Its pending approvals/requests come from the shared
  // attention store, filtered to this job.
  const store = useStores()
  const [job, setJob] = useState<JobDetailRow>()
  const [error, setError] = useState<string>()
  // null means "follow the job's state" — open while it's live, closed once done.
  const [activityOpen, setActivityOpen] = useState<boolean | null>(null)
  const [summaryCopied, setSummaryCopied] = useState(false)

  const reloadJob = useCallback(() => {
    api.jobs.get(id).then(
      (row) => {
        setJob(row)
        setError(undefined)
      },
      (caught) => setError(caught instanceof Error ? caught.message : "Could not load the job."),
    )
  }, [id])

  useEffect(() => reloadJob(), [reloadJob])
  useOperatorEvent((event) => {
    if (event.type === "job.state.changed") reloadJob()
  })

  const act = useCallback(
    async (action: string, body?: Record<string, unknown>) => {
      await api.jobs.action(id, action, body)
      reloadJob()
    },
    [id, reloadJob],
  )

  const attention = store.attention.items.filter((item) => item.jobId === id)
  const answer = store.attention.answer
  const resolve = store.attention.resolve
  const dismiss = store.attention.dismiss

  if (error)
    return (
      <div className="p-6 text-secondary text-status-failed">
        Could not load job #{id}: {error}
      </div>
    )
  if (!job) return <div className="p-6 text-secondary text-ink-muted">Loading job #{id}…</div>

  const isOpen = !TERMINAL.has(job.state)
  const assignee = store.roster.members.find((member) => member.id === job.assigneeAgent)
  const assigneeName = assignee?.name ?? job.assigneeAgent ?? ""
  // The job runs in the assignee's Flue session, `<tenant>:<assignee>__job-<id>`.
  const session = job.assigneeAgent
    ? `${me.tenantId}:${job.assigneeAgent}__job-${job.id}`
    : undefined
  const showActivity = activityOpen ?? isOpen

  async function copySummary() {
    if (!job?.summary) return
    await navigator.clipboard.writeText(job.summary)
    setSummaryCopied(true)
    setTimeout(() => setSummaryCopied(false), 1500)
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate("/jobs")}
            className="font-mono text-mono text-ink-muted hover:text-ink-primary"
          >
            ← Jobs
          </button>
          <span className="font-mono text-mono text-ink-faint">#{job.id}</span>
          <h1 className="text-heading font-semibold">{job.title}</h1>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-mono text-ink-muted">
            <StatusDot status={jobStatus(job.state)} />
            {jobStateLabel(job.state)}
          </span>
        </header>

        {job.summary && (
          <section className="rounded-card border border-line-default bg-surface-card p-[18px]">
            <SectionHeader
              tone="neutral"
              meta={
                <button
                  type="button"
                  onClick={() => void copySummary()}
                  className="cursor-pointer border-0 bg-transparent font-mono text-mono text-ink-muted hover:text-ink-primary"
                >
                  {summaryCopied ? "Copied" : "Copy as Markdown"}
                </button>
              }
            >
              Closing summary
            </SectionHeader>
            <div className="markdown mt-3 text-body">
              <Markdown>{job.summary}</Markdown>
            </div>
          </section>
        )}

        {attention.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {attention.map((item) =>
              item.kind === "approval" ? (
                <ApprovalCard key={item.id} item={item} onAnswer={answer} />
              ) : (
                <RequestCard key={item.id} item={item} onResolve={resolve} onDismiss={dismiss} />
              ),
            )}
          </div>
        )}

        {job.instruction && (
          <details className="group rounded-card border border-line-default bg-surface-card p-[18px]">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="font-sans text-meta font-semibold tracking-[0.8px] uppercase text-ink-meta">
                Prompt
              </span>
              <span className="h-px flex-1 bg-line-subtle" />
              <i className="ti ti-chevron-down text-ink-faint transition-transform group-open:rotate-180" />
            </summary>
            <div className="markdown mt-3 text-body [overflow-wrap:break-word]">
              <Markdown>{job.instruction}</Markdown>
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {isOpen && job.state !== "paused" && (
            <Button variant="secondary" onClick={() => void act("pause")}>
              Pause
            </Button>
          )}
          {isOpen && job.state !== "paused" && (
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm("Stop this job? This can't be undone.")) void act("stop")
              }}
            >
              Stop
            </Button>
          )}
          {job.state === "paused" && (
            <Button variant="primary" onClick={() => void act("resume")}>
              Resume
            </Button>
          )}
          {job.state === "failed" && (
            <Button variant="primary" onClick={() => void act("restart")}>
              Restart
            </Button>
          )}
          {(job.state === "paused" || job.state === "failed") && (
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm("Cancel this job? This can't be undone.")) void act("cancel")
              }}
            >
              Cancel
            </Button>
          )}
          <span className="ml-auto font-mono text-mono text-ink-faint">
            {job.originatorAgent} → {job.assigneeAgent ?? "unassigned"} · opened{" "}
            {timeAgo(job.createdAt)}
          </span>
        </div>

        {session && (
          <section>
            <SectionHeader
              tone={jobStatus(job.state) === "working" ? "working" : "neutral"}
              meta={
                <button
                  type="button"
                  onClick={() => setActivityOpen(!showActivity)}
                  className="cursor-pointer border-0 bg-transparent font-mono text-mono text-ink-muted hover:text-ink-primary"
                >
                  {showActivity ? "Hide" : "Show"}
                </button>
              }
            >
              Activity
            </SectionHeader>
            {showActivity ? (
              <JobActivity
                key={session}
                session={session}
                agent={job.assigneeAgent ?? ""}
                agentInitials={initials(assigneeName)}
              />
            ) : (
              <div className="mt-3 text-secondary text-ink-muted">
                {assigneeName}&rsquo;s live work on this job — thinking, tool calls, and replies.
              </div>
            )}
          </section>
        )}

        {job.entries.length > 0 && (
          <section>
            <SectionHeader tone="neutral">Timeline</SectionHeader>
            <div className="mt-4">
              <Timeline>
                {job.entries.map((entry) => (
                  <TimelineEntry
                    key={entry.id}
                    state={jobEntryState(entry.kind)}
                    title={`${entry.actor.kind === "agent" ? entry.actor.id : entry.actor.kind} · ${entry.kind}`}
                    time={clock(entry.timestamp)}
                  >
                    {entry.text && (
                      <div className="text-secondary text-ink-muted">
                        <Summary text={entry.text} />
                      </div>
                    )}
                  </TimelineEntry>
                ))}
              </Timeline>
            </div>
          </section>
        )}

        {job.children.length > 0 && (
          <section>
            <SectionHeader tone="neutral">Children</SectionHeader>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => navigate(`/jobs/${child.id}`)}
                  className="cursor-pointer rounded-chip border border-line-strong bg-line-subtle px-[9px] py-[5px] font-mono text-mono text-ink-muted hover:text-ink-primary"
                >
                  #{child.id} · {jobStateLabel(child.state)}
                </button>
              ))}
            </div>
          </section>
        )}

        {isOpen && (
          <Composer placeholder="Steer this job…" onSend={(message) => act("steer", { message })} />
        )}
      </div>
    </div>
  )
})

/**
 * The live transcript of the job's session — the same rendering the chat screen
 * uses, bounded to a scrolling box so it sits inside the job page. Read-only:
 * steering goes through the box at the foot of the page. Keyed by session
 * upstream, so a handoff to a new assignee mounts a fresh connection.
 */
function JobActivity({
  session,
  agent,
  agentInitials,
}: {
  session: string
  agent: string
  agentInitials: string
}) {
  const url = useMemo(() => `/agents/${session}`, [session])
  const conversation = useFlueAgent({ url })
  return (
    <Transcript
      conversation={conversation}
      agent={agent}
      agentInitials={agentInitials}
      containerClassName="mt-3 flex max-h-[520px] flex-col gap-6 overflow-y-auto rounded-card border border-line-default bg-surface-card p-4"
    />
  )
}
