import { observer } from "mobx-react-lite"
import { type ReactNode, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { Markdown } from "../components/Markdown.tsx"
import { Button, StatusDot } from "../design/index.ts"
import { api } from "../lib/api.ts"
import { initials, timeAgo } from "../lib/format.ts"
import { describeSchedule } from "../lib/schedule.ts"
import { useStores } from "../stores/context.tsx"

/** One schedule: when it runs, owner, prompt, with pause/resume, edit, and delete. */
export const Schedule = observer(function Schedule() {
  const navigate = useNavigate()
  const id = useParams().id ?? ""
  // Backed by the schedules list in the store, so the operator stream's
  // `schedule.changed` keeps this page current with no timer of its own.
  const store = useStores()
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void store.schedules.load().then(() => setLoaded(true))
  }, [store])
  // Moving between schedules must not carry an open editor or a stale error.
  useEffect(() => {
    setEditing(false)
    setError(undefined)
  }, [])

  const schedule = store.schedules.schedules.find((entry) => entry.id === id)

  if (!loaded) return <div className="p-6 text-secondary text-ink-muted">Loading schedule…</div>
  if (!schedule)
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="text-secondary text-status-failed">No schedule “{id}”.</div>
        <button
          type="button"
          onClick={() => navigate("/schedules")}
          className="w-fit cursor-pointer border-0 bg-transparent p-0 text-secondary text-ink-faint hover:text-ink-primary"
        >
          ← Back to schedules
        </button>
      </div>
    )

  const ownerName = store.roster.nameOf(schedule.agent)
  const enabled = schedule.enabled
  const completed = schedule.completedAt !== null
  const trimmed = draft.trim()
  const canSave = !saving && trimmed !== "" && trimmed !== schedule.instruction

  async function savePrompt() {
    if (!canSave) return
    setSaving(true)
    setError(undefined)
    try {
      await api.schedules.update(id, { instruction: trimmed })
      setEditing(false)
      void store.schedules.load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the prompt.")
    } finally {
      setSaving(false)
    }
  }

  async function toggle() {
    await api.schedules.update(id, { enabled: !enabled })
    void store.schedules.load()
  }

  async function toggleReporting() {
    const next = schedule?.reportMode === "always" ? "on_request" : "always"
    await api.schedules.update(id, { reportMode: next })
    void store.schedules.load()
  }

  async function remove() {
    if (!confirm(`Delete schedule “${schedule?.title}”? This cannot be undone.`)) return
    await api.schedules.remove(id)
    navigate("/schedules")
  }

  const statusLabel = completed ? "DONE" : enabled ? "ON" : "OFF"

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-2 text-meta text-ink-faint">
          <button
            type="button"
            onClick={() => navigate("/schedules")}
            className="cursor-pointer border-0 bg-transparent p-0 text-ink-faint hover:text-ink-primary"
          >
            Schedules
          </button>
          <span className="text-ink-label">/</span>
          <span className="truncate text-ink-meta">{schedule.title}</span>
        </div>

        <header className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-0 flex-[1_1_440px]">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-heading font-semibold tracking-[-0.3px]">{schedule.title}</h1>
              <span className="flex items-center gap-[7px] rounded-full border border-line-strong bg-surface-card px-2.5 py-[5px] font-mono text-label tracking-[0.5px] text-ink-muted">
                <StatusDot status={completed ? "idle" : enabled ? "done" : "idle"} size={5} />
                {statusLabel}
              </span>
            </div>
            <div className="mt-[7px] text-secondary text-ink-meta">
              {describeSchedule(schedule.timing)} · owned by {ownerName}
              {completed
                ? ` · completed ${timeAgo(schedule.completedAt as string)}`
                : schedule.lastFiredAt
                  ? ` · last fired ${timeAgo(schedule.lastFiredAt)}`
                  : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!completed && (
              <Button variant={enabled ? "secondary" : "primary"} onClick={() => void toggle()}>
                {enabled ? "Pause" : "Resume"}
              </Button>
            )}
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-px overflow-hidden rounded-card border border-line-default bg-line-subtle *:bg-surface-card">
          <Fact label="Owned by">
            <div className="mt-2 flex items-center gap-2.5">
              <span className="grid h-[22px] w-[22px] place-items-center rounded-monogram bg-surface-control font-mono text-label text-ink-monogram">
                {initials(ownerName)}
              </span>
              <span className="text-secondary font-semibold text-ink-primary">{ownerName}</span>
            </div>
          </Fact>
          <Fact label="When">
            <div className="mt-2 font-mono text-mono text-ink-body">
              {describeSchedule(schedule.timing)}
            </div>
            <div className="mt-[3px] font-mono text-mono text-ink-faint">
              {schedule.catchUp ? "catches up a missed run" : "skips a missed run"}
            </div>
          </Fact>
          <Fact label={completed ? "Completed" : "Last fired"}>
            <div className="mt-2 text-secondary text-ink-body">
              {completed
                ? timeAgo(schedule.completedAt as string)
                : schedule.lastFiredAt
                  ? `${timeAgo(schedule.lastFiredAt)}`
                  : "never"}
            </div>
          </Fact>
          <Fact label="Deadline">
            <div className="mt-2 text-secondary text-ink-body">
              {schedule.deadlineSeconds ? `${schedule.deadlineSeconds}s` : "none"}
            </div>
          </Fact>
          <Fact label="Reporting">
            <div className="mt-2 text-secondary text-ink-body">
              {schedule.reportMode === "always" ? "every run" : "only when notable"}
            </div>
            {!completed && (
              <button
                type="button"
                onClick={() => void toggleReporting()}
                className="mt-[3px] cursor-pointer border-0 bg-transparent p-0 font-mono text-mono text-ink-faint hover:text-ink-primary"
              >
                {schedule.reportMode === "always" ? "make quiet" : "report every run"}
              </button>
            )}
          </Fact>
        </div>

        <section className="rounded-card border border-line-default bg-surface-card p-[18px]">
          <div className="flex items-center gap-3">
            <div className="font-sans text-meta font-semibold tracking-[0.8px] uppercase text-ink-meta">
              Prompt
            </div>
            <div className="h-px flex-1 bg-line-subtle" />
            {editing ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={!canSave} onClick={() => void savePrompt()}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            ) : (
              !completed && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(schedule.instruction)
                    setError(undefined)
                    setEditing(true)
                  }}
                  className="cursor-pointer border-0 bg-transparent p-0 font-mono text-mono text-ink-faint hover:text-ink-primary"
                >
                  Edit
                </button>
              )
            )}
          </div>

          {editing ? (
            <textarea
              autoFocus
              rows={10}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="mt-3 w-full resize-y rounded-control border border-line-strong bg-surface-panel px-3 py-2 font-sans text-body leading-[1.5] text-ink-primary outline-none focus:border-line-accent"
            />
          ) : (
            <div className="markdown mt-3 text-body [overflow-wrap:break-word]">
              <Markdown>{schedule.instruction}</Markdown>
            </div>
          )}

          {error && <div className="mt-2 text-meta text-status-failed">{error}</div>}
        </section>
      </div>
    </div>
  )
})

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-[18px] py-[15px]">
      <div className="text-label font-semibold tracking-[0.7px] uppercase text-ink-label">
        {label}
      </div>
      {children}
    </div>
  )
}
