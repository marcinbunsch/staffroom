import { OPERATOR_PROFILE_LIMIT, OPERATOR_PROFILE_TEMPLATE } from "@staffroom/protocol"
import { useEffect, useState } from "react"
import { Button } from "../../design/index.ts"
import { api } from "../../lib/api.ts"
import { timeAgo } from "../../lib/format.ts"

/**
 * The operator profile — who your staff work for. It is prepended to every one
 * of your agents' system prompts, so an agent that meets your name in Slack,
 * GitHub, or mail knows that it is you. Per-account, and capped, because it is
 * paid for on every turn.
 */
export function OperatorProfileSection() {
  const [text, setText] = useState("")
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    api.operator.getProfile().then(
      (profile) => {
        setText(profile.text)
        setUpdatedAt(profile.updatedAt)
        setLoaded(true)
      },
      () => setLoaded(true),
    )
  }, [])

  async function save() {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      const profile = await api.operator.setProfile(text)
      setUpdatedAt(profile.updatedAt)
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the profile.")
    } finally {
      setBusy(false)
    }
  }

  const over = text.length > OPERATOR_PROFILE_LIMIT

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Operator profile</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        Who your staff work for. It is prepended to every agent’s prompt, so an agent that finds
        your name and handles in Slack, GitHub, Notion, or mail knows that they are yours.
      </p>

      {error && <p className="mt-4 text-secondary text-status-failed">{error}</p>}

      <textarea
        value={text}
        disabled={!loaded}
        onChange={(event) => {
          setText(event.target.value)
          setSaved(false)
        }}
        placeholder={OPERATOR_PROFILE_TEMPLATE}
        rows={14}
        className="mt-4 w-full resize-y rounded-control border border-line-strong bg-surface-inset px-3 py-2 font-mono text-mono leading-relaxed text-ink-body outline-none placeholder:text-ink-faint focus:border-line-accent"
      />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || over || !loaded} onClick={() => void save()}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
        <span className={`text-meta ${over ? "text-status-failed" : "text-ink-faint"}`}>
          {text.length.toLocaleString()} / {OPERATOR_PROFILE_LIMIT.toLocaleString()}
        </span>
        {saved && <span className="text-meta text-ink-faint">Saved.</span>}
        {!saved && updatedAt && (
          <span className="text-meta text-ink-faint">Updated {timeAgo(updatedAt)}</span>
        )}
      </div>
    </section>
  )
}
