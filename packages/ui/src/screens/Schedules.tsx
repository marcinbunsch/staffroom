import { observer } from "mobx-react-lite"
import { type ReactNode, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { StatusDot } from "../design/index.ts"
import { type ScheduleRow } from "../lib/api.ts"
import { initials, timeAgo } from "../lib/format.ts"
import { describeSchedule } from "../lib/schedule.ts"
import { useStores } from "../stores/context.tsx"

type Filter = "all" | "on" | "paused" | "done"

// The lifecycle state of a schedule row. A one-off that fired is "done" and
// kept as a record; recurring schedules are "on" or "paused".
function scheduleState(schedule: ScheduleRow): "done" | "on" | "paused" {
  if (schedule.completedAt) return "done"
  return schedule.enabled ? "on" : "paused"
}

// Columns: status dot · name · owner · schedule · last run.
const ROW =
  "grid grid-cols-[7px_minmax(0,1fr)] @[900px]:grid-cols-[7px_minmax(0,1fr)_150px_160px_120px] items-center gap-x-4 gap-y-2 px-3"

/**
 * Schedules as a scannable list — recurring ones (that run as a routine) and
 * one-offs alike. Each row opens the schedule. A one-off that has fired shows as
 * done and is kept as a record; v2 has no last-job link, so a row's tail is its
 * last-fired time rather than the last run's outcome.
 */
export const Schedules = observer(function Schedules() {
  const navigate = useNavigate()
  // From the store, refreshed by the operator stream's `schedule.changed`.
  const store = useStores()
  const schedules = store.schedules.schedules
  const [filter, setFilter] = useState<Filter>("all")

  useEffect(() => void store.schedules.load(), [store])

  const onCount = schedules.filter((schedule) => scheduleState(schedule) === "on").length
  const pausedCount = schedules.filter((schedule) => scheduleState(schedule) === "paused").length
  const doneCount = schedules.filter((schedule) => scheduleState(schedule) === "done").length
  const shown = schedules.filter((schedule) =>
    filter === "all" ? true : scheduleState(schedule) === filter,
  )
  const ownerName = (id: string) => store.roster.nameOf(id)

  return (
    <div className="h-full overflow-y-auto px-[clamp(16px,4vw,44px)] pt-[clamp(20px,3vw,28px)] pb-7">
      <div className="mx-auto flex w-full max-w-content flex-col gap-6">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
          <div className="min-w-0 flex-[1_1_420px]">
            <h1 className="self-start text-title font-semibold tracking-[-0.3px]">Schedules</h1>
            <div className="mt-[7px] text-secondary text-ink-meta">
              {schedules.length === 0
                ? "No schedules yet."
                : `${onCount} on${pausedCount ? ` · ${pausedCount} paused` : ""}${
                    doneCount ? ` · ${doneCount} done` : ""
                  }`}
            </div>
          </div>
          <Link
            to="/schedules/new"
            className="rounded-control border border-line-control bg-surface-control-hover px-[15px] py-2 text-secondary font-medium text-ink-primary hover:bg-surface-control-active"
          >
            New schedule
          </Link>
        </div>

        {schedules.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              All {schedules.length}
            </Chip>
            <Chip active={filter === "on"} onClick={() => setFilter("on")}>
              On {onCount}
            </Chip>
            <Chip active={filter === "paused"} onClick={() => setFilter("paused")}>
              Paused {pausedCount}
            </Chip>
            {doneCount > 0 && (
              <Chip active={filter === "done"} onClick={() => setFilter("done")}>
                Done {doneCount}
              </Chip>
            )}
          </div>
        )}

        <div className="@container">
          <div
            className={`${ROW} hidden @[900px]:grid border-b border-line-default pb-2.5 *:text-label *:font-semibold *:tracking-[0.7px] *:uppercase *:text-ink-label`}
          >
            <span />
            <span>Schedule</span>
            <span>Owner</span>
            <span>When</span>
            <span className="text-right">Last fired</span>
          </div>

          {shown.length === 0 && (
            <div className="px-3 py-4 text-secondary text-ink-muted">Nothing here.</div>
          )}

          {shown.map((schedule) => (
            <Row
              key={schedule.id}
              schedule={schedule}
              ownerName={ownerName(schedule.agent)}
              onOpen={() => navigate(`/schedules/${schedule.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  )
})

function Row({
  schedule,
  ownerName,
  onOpen,
}: {
  schedule: ScheduleRow
  ownerName: string
  onOpen: () => void
}) {
  const state = scheduleState(schedule)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      className={`${ROW} cursor-pointer border-b border-line-subtle py-[15px] last:border-b-0 hover:bg-surface-card`}
    >
      <StatusDot status={state === "on" ? "done" : "idle"} size={7} />
      <span className="min-w-0">
        <span
          className={`block truncate text-secondary font-semibold ${state === "on" ? "text-ink-primary" : "text-ink-muted"}`}
        >
          {schedule.title}
          {state === "paused" ? " · paused" : state === "done" ? " · done" : ""}
        </span>
        <span className="mt-[3px] block truncate font-mono text-mono text-ink-faint">
          {state === "done"
            ? schedule.completedAt
              ? `completed ${timeAgo(schedule.completedAt)}`
              : "completed"
            : state === "on"
              ? schedule.lastFiredAt
                ? `last fired ${timeAgo(schedule.lastFiredAt)}`
                : "not run yet"
              : "paused"}
        </span>
      </span>
      <span className="col-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 @[900px]:col-start-auto @[900px]:contents">
        <span className="flex min-w-0 items-center gap-2">
          <span className="grid h-[20px] w-[20px] shrink-0 place-items-center rounded-[5px] bg-surface-control font-mono text-[9px] text-ink-monogram">
            {initials(ownerName)}
          </span>
          <span className="truncate text-secondary text-ink-muted">{ownerName}</span>
        </span>
        <span className="truncate font-mono text-mono text-ink-muted">
          {describeSchedule(schedule.timing)}
        </span>
        <span className="font-mono text-mono text-ink-faint @[900px]:text-right">
          {schedule.lastFiredAt ? timeAgo(schedule.lastFiredAt) : "never"}
        </span>
      </span>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-chip border px-2.5 py-[5px] text-meta ${
        active
          ? "border-line-control bg-surface-selected font-medium text-ink-primary"
          : "border-line-strong bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
      }`}
    >
      {children}
    </button>
  )
}
