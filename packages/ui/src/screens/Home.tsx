import { parseSessionKey } from "@staffroom/protocol"
import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { Link, useNavigate } from "react-router"
import { ApprovalCard } from "../components/ApprovalCard.tsx"
import { RequestCard } from "../components/RequestCard.tsx"
import { AgentWorkCard, Avatar, SectionHeader, StatusDot, UnreadBadge } from "../design/index.ts"
import { type AttentionRow, type JobRow } from "../lib/api.ts"
import { initials, timeAgo } from "../lib/format.ts"
import { jobStateLabel, jobStatus, presenceStatus } from "../lib/status.ts"
import { useStores } from "../stores/context.tsx"

const TERMINAL = new Set(["done", "failed", "cancelled"])
const WEEK_MS = 7 * 86_400_000
const RECENT_LIMIT = 6

/**
 * The home page: what needs you, first. An exception-first landing that answers
 * "where do I look?" — attention items you can act on in place, then the agents
 * with unread messages, what's running now, and what finished recently. A
 * section with nothing in it is simply absent; when everything is clear, the
 * page says so.
 *
 * Every slice is already live in the shared stores (attention and presence load
 * with the shell; jobs load here and stay fresh off the operator stream), so
 * this is a read — no timer, no fetch of its own beyond the jobs board.
 */
export const Home = observer(function Home() {
  const store = useStores()
  const navigate = useNavigate()
  useEffect(() => void store.jobs.load(), [store])

  const approvals = store.attention.approvals
  const requests = store.attention.requests
  const jobs = store.jobs.jobs
  const roster = store.roster.members
  const nameOf = (id: string | null) => (id ? store.roster.nameOf(id) : "unassigned")

  // Paused/failed top-level jobs need you too — and would otherwise be invisible
  // here (Working now is live, Recent is finished), so they join the top.
  const blocked = jobs.filter(
    (job) => job.parentId === null && (job.state === "paused" || job.state === "failed"),
  )
  const working = jobs.filter((job) => !TERMINAL.has(job.state) && job.state !== "paused")
  const recent = jobs
    .filter(
      (job) =>
        job.parentId === null &&
        (job.state === "done" || job.state === "cancelled") &&
        Date.now() - new Date(job.updatedAt).getTime() < WEEK_MS,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_LIMIT)

  const unread = roster
    .map((member) => ({ member, overview: store.presence.overviewFor(member.id) }))
    .filter((row) => (row.overview?.unreadCount ?? 0) > 0)
    .sort((a, b) => (b.overview?.unreadCount ?? 0) - (a.overview?.unreadCount ?? 0))

  const needsYou = approvals.length + requests.length + blocked.length
  const unreadTotal = unread.reduce((sum, row) => sum + (row.overview?.unreadCount ?? 0), 0)
  const allClear =
    needsYou === 0 && working.length === 0 && unread.length === 0 && recent.length === 0

  const summary = [
    needsYou > 0 && `${needsYou} ${needsYou === 1 ? "thing needs" : "things need"} you`,
    working.length > 0 && `${working.length} working`,
    unreadTotal > 0 && `${unreadTotal} unread`,
  ].filter(Boolean)

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-[calc(1.75rem_+_env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-content flex-col gap-9">
        <header className="flex flex-col gap-1">
          <h1 className="text-title font-semibold tracking-[-0.3px]">{greeting()}</h1>
          <p className="text-secondary text-ink-muted">
            {dateLine()}
            {summary.length > 0 && ` · ${summary.join(" · ")}`}
          </p>
        </header>

        {allClear && (
          <div className="rounded-card border border-line-default bg-surface-card px-5 py-8 text-center">
            <div className="text-body font-medium text-ink-primary">You’re all caught up</div>
            <div className="mt-1 text-secondary text-ink-muted">
              Nothing needs you. New attention, replies and job output will show up here.
            </div>
          </div>
        )}

        {needsYou > 0 && (
          <section>
            <SectionHeader tone="attention" meta={`${needsYou}`}>
              Needs you
            </SectionHeader>
            <div className="mt-4 flex flex-col gap-3">
              {approvals.map((item) => (
                <div key={item.id} className="flex flex-col gap-1.5">
                  <ItemContext item={item} agentName={nameOf(item.agent)} />
                  <ApprovalCard item={item} onAnswer={store.attention.answer} />
                </div>
              ))}
              {requests.map((item) => (
                <div key={item.id} className="flex flex-col gap-1.5">
                  <ItemContext item={item} agentName={nameOf(item.agent)} />
                  <RequestCard
                    item={item}
                    onResolve={store.attention.resolve}
                    onDismiss={store.attention.dismiss}
                  />
                </div>
              ))}
              {blocked.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  agent={nameOf(job.assigneeAgent)}
                  onOpen={navigate}
                />
              ))}
            </div>
          </section>
        )}

        {unread.length > 0 && (
          <section>
            <SectionHeader meta={`${unread.length}`}>Unread messages</SectionHeader>
            <div className="mt-4 flex flex-col gap-2">
              {unread.map(({ member, overview }) => {
                const status = presenceStatus(overview?.activity ?? "idle")
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => navigate(`/a/${member.id}`)}
                    className="flex items-center gap-3 rounded-row border border-line-inset bg-surface-card-hover px-3 py-2.5 text-left hover:border-line-accent"
                  >
                    <Avatar
                      initials={initials(member.name)}
                      size="md"
                      status={status === "idle" ? undefined : status}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-secondary text-ink-primary">{member.name}</div>
                      {overview?.label && (
                        <div className="truncate font-mono text-mono text-ink-faint">
                          {overview.label}
                        </div>
                      )}
                    </div>
                    <UnreadBadge count={overview?.unreadCount} />
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {working.length > 0 && (
          <section>
            <SectionHeader tone="working" meta={`${working.length}`}>
              Working now
            </SectionHeader>
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-2.5">
              {working.map((job) => (
                <AgentWorkCard
                  key={job.id}
                  name={nameOf(job.assigneeAgent ?? job.originatorAgent)}
                  initials={initials(nameOf(job.assigneeAgent ?? job.originatorAgent))}
                  status="working"
                  work={job.title}
                  left={`#${job.id}`}
                  right={timeAgo(job.createdAt)}
                  onClick={() => navigate(`/jobs/${job.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {recent.length > 0 && (
          <section>
            <SectionHeader meta={`${recent.length}`}>Recent jobs</SectionHeader>
            <div className="mt-4 flex flex-col gap-2.5">
              {recent.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  agent={nameOf(job.assigneeAgent)}
                  onOpen={navigate}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
})

/** Who raised an attention item and where it came from — its chat, or its job. */
function ItemContext({ item, agentName }: { item: AttentionRow; agentName: string }) {
  const target = item.jobId !== null ? `/jobs/${item.jobId}` : chatTarget(item)
  const where = item.jobId !== null ? `job #${item.jobId}` : "chat"
  return (
    <div className="flex items-center gap-2 font-mono text-mono text-ink-faint">
      <span>{agentName}</span>
      <span>·</span>
      <Link to={target} className="hover:text-ink-primary">
        {where}
      </Link>
      <span>·</span>
      <span>{timeAgo(item.createdAt)}</span>
    </div>
  )
}

/** A compact job row for the blocked and recent lists. */
function JobCard({
  job,
  agent,
  onOpen,
}: {
  job: JobRow
  agent: string
  onOpen: (to: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(`/jobs/${job.id}`)}
      className="flex flex-wrap items-center gap-2.5 rounded-card border border-line-default bg-surface-card px-[18px] py-3.5 text-left transition-colors duration-[120ms] ease-out hover:border-line-accent"
    >
      <span className="font-mono text-mono text-ink-faint">#{job.id}</span>
      <span className="font-semibold">{job.title}</span>
      <span className="ml-auto flex items-center gap-1.5 font-mono text-mono text-ink-muted">
        <StatusDot status={jobStatus(job.state)} />
        {jobStateLabel(job.state)}
      </span>
      <span className="w-full font-mono text-mono text-ink-faint">
        {agent} · {timeAgo(job.updatedAt)}
      </span>
    </button>
  )
}

/** The chat route an attention item came from, or the agent's default chat. */
function chatTarget(item: AttentionRow): string {
  const chat = parseSessionKey(item.session)?.chat
  return chat ? `/a/${item.agent}/c/${chat.id}` : `/a/${item.agent}`
}

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return "Good evening"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function dateLine(): string {
  return new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
}
