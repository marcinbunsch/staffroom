import { type FormEvent, useState } from "react"
import { useNavigate } from "react-router"
import { Button } from "../design/index.ts"
import { type StaffRow, type Timing, api } from "../lib/api.ts"

type TimingKind = "cron" | "interval" | "once"

/**
 * Create a schedule: who runs it, when, with what standing instruction. A
 * schedule runs as a routine (recurring — cron or an interval) or once (a
 * one-off at a specific time, then it's done). The prototype made these from the
 * CLI; v2 makes them in-app, so a self-hosted operator never needs a terminal.
 */
export function NewSchedule({ roster }: { roster: StaffRow[] }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState("")
  const [agent, setAgent] = useState(roster[0]?.id ?? "")
  const [instruction, setInstruction] = useState("")
  const [timingKind, setTimingKind] = useState<TimingKind>("cron")
  const [cron, setCron] = useState("0 9 * * *")
  const [intervalSeconds, setIntervalSeconds] = useState(3600)
  const [onceAt, setOnceAt] = useState("")
  const [catchUp, setCatchUp] = useState(false)
  const [deadline, setDeadline] = useState("")
  const [reportMode, setReportMode] = useState<"always" | "on_request">("on_request")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  function buildTiming(): Timing | string {
    if (timingKind === "cron") return { kind: "cron", expression: cron.trim() }
    if (timingKind === "interval") return { kind: "interval", seconds: intervalSeconds }
    // datetime-local gives a local wall-clock string; turn it into a UTC instant.
    const when = new Date(onceAt)
    if (Number.isNaN(when.getTime())) return "Pick a date and time for the one-off."
    if (when.getTime() <= Date.now()) return "The one-off time must be in the future."
    return { kind: "once", at: when.toISOString() }
  }

  async function create() {
    const timing = buildTiming()
    if (typeof timing === "string") {
      setError(timing)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const { schedule } = await api.schedules.create({
        title: title.trim(),
        agent,
        instruction: instruction.trim(),
        timing,
        catchUp,
        deadlineSeconds: deadline ? Number(deadline) : null,
        reportMode,
      })
      navigate(`/schedules/${schedule.id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the schedule.")
      setBusy(false)
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void create()
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="self-start text-title font-semibold tracking-[-0.3px]">New schedule</h1>

        <Field label="Title">
          <input
            className={input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Morning triage"
            required
          />
        </Field>

        <Field label="Agent" hint="who runs it">
          <select
            className={input}
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
          >
            {roster.length === 0 && <option value="">No agents yet</option>}
            {roster.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Instruction" hint="the standing prompt each run gets">
          <textarea
            className={`${input} min-h-28`}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="Review open PRs and summarise anything waiting on us."
            required
          />
        </Field>

        <Field label="When" hint="run repeatedly (as a routine) or once">
          <div className="flex gap-2">
            <select
              className={`${input} w-36`}
              value={timingKind}
              onChange={(event) => setTimingKind(event.target.value as TimingKind)}
            >
              <optgroup label="Repeat (routine)">
                <option value="cron">Cron</option>
                <option value="interval">Every…</option>
              </optgroup>
              <optgroup label="One-off">
                <option value="once">Once</option>
              </optgroup>
            </select>
            {timingKind === "cron" && (
              <input
                className={`${input} font-mono`}
                value={cron}
                onChange={(event) => setCron(event.target.value)}
                placeholder="0 9 * * *"
                required
              />
            )}
            {timingKind === "interval" && (
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className={`${input} w-32`}
                  value={intervalSeconds}
                  onChange={(event) => setIntervalSeconds(Number(event.target.value))}
                  required
                />
                <span className="text-secondary text-ink-muted">seconds</span>
              </div>
            )}
            {timingKind === "once" && (
              <input
                type="datetime-local"
                className={`${input} flex-1`}
                value={onceAt}
                onChange={(event) => setOnceAt(event.target.value)}
                required
              />
            )}
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-secondary text-ink-body">
            <input
              type="checkbox"
              checked={catchUp}
              onChange={(event) => setCatchUp(event.target.checked)}
            />
            Catch up a missed run on restart
          </label>
          <Field label="Deadline" hint="seconds, optional">
            <input
              type="number"
              min={1}
              className={`${input} w-32`}
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              placeholder="none"
            />
          </Field>
        </div>

        <Field label="Reporting" hint="when a run reports back to the chat">
          <select
            className={input}
            value={reportMode}
            onChange={(event) => setReportMode(event.target.value as "always" | "on_request")}
          >
            <option value="on_request">Only when there's something to report</option>
            <option value="always">Every run</option>
          </select>
        </Field>

        {error && <p className="text-secondary text-status-failed">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate("/schedules")}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !agent} onClick={() => void create()}>
            {busy ? "Creating…" : "Create schedule"}
          </Button>
        </div>
      </form>
    </div>
  )
}

const input =
  "w-full rounded-control border border-line-strong bg-surface-inset px-3 py-2 text-secondary text-ink-body outline-none focus:border-line-accent"

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-label text-ink-muted uppercase tracking-[0.6px]">
        {label}
        {hint && <span className="ml-1 normal-case text-ink-faint">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
