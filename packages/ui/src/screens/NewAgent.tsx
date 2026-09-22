import { type FormEvent, useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { ModelPicker } from "../components/ModelPicker.tsx"
import { type ModelCredentialRow, api } from "../lib/api.ts"

/**
 * Add an agent: an id, a name, a role description, a system prompt, and which credential pays for
 * it. A row with no credential falls back to the org default; the picker offers
 * the connected ones so a new agent is usable immediately.
 */
export function NewAgent({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate()
  const [id, setId] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.")
  const [model, setModel] = useState("")
  const [credentialId, setCredentialId] = useState("")
  const [credentials, setCredentials] = useState<ModelCredentialRow[]>([])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.models.list().then(
      (rows) => {
        setCredentials(rows)
        // Default to a usable credential so a new agent works immediately. Leave
        // "org default" only when an org default actually exists; otherwise pick
        // the first personal one, so onboarding never creates a dead agent.
        const orgDefault = rows.find((row) => row.isDefault)
        if (!orgDefault && rows[0]) setCredentialId(rows[0].id)
      },
      () => {},
    )
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.staff.create({
        id,
        name: name || id,
        description,
        systemPrompt,
        model: model || null,
        credentialId: credentialId || null,
      })
      onCreated()
      navigate(`/a/${id}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the agent.")
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-xl px-6 py-6">
      <h1 className="mb-4 text-base font-semibold text-ink-primary">New agent</h1>

      <Field label="Id" hint="lowercase, letters, digits and hyphens">
        <input
          className={input}
          value={id}
          onChange={(event) => setId(event.target.value.toLowerCase())}
          placeholder="devops"
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        />
      </Field>
      <Field label="Name">
        <input
          className={input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="DevOps"
        />
      </Field>
      <Field label="Role description" hint="shown to other agents when they choose who to ask">
        <textarea
          className={`${input} min-h-20`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={280}
          placeholder="Keeps production systems reliable and handles incidents."
        />
      </Field>
      <Field label="System prompt">
        <textarea
          className={`${input} min-h-28`}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Model" hint="blank = default">
          <ModelPicker
            credentialId={credentialId}
            value={model}
            onChange={setModel}
            className={input}
          />
        </Field>
        <Field label="Credential" hint="blank = default">
          <select
            className={input}
            value={credentialId}
            onChange={(event) => setCredentialId(event.target.value)}
          >
            <option value="">Default credential</option>
            {credentials.map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.label} ({credential.upstream})
              </option>
            ))}
          </select>
        </Field>
      </div>

      {error && <p className="mb-3 text-sm text-status-failed">{error}</p>}
      {credentials.length === 0 && (
        <p className="mb-3 text-sm text-ink-muted">
          No model credentials yet — the agent will only work once one is connected in Settings.
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-surface-control-hover px-4 py-2 text-sm font-medium text-ink-primary hover:bg-surface-control-active disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create agent"}
      </button>
    </form>
  )
}

const input =
  "w-full rounded-lg border border-line-default bg-surface-inset px-3 py-2 text-sm text-ink-body outline-none focus:border-line-strong"

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
    <label className="mb-3 block flex-1">
      <span className="mb-1 block text-xs text-ink-muted">
        {label}
        {hint && <span className="ml-1 text-ink-faint">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
