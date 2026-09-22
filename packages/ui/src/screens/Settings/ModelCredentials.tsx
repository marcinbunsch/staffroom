import { LM_STUDIO_DEFAULT_BASE_URL, LM_STUDIO_UPSTREAM } from "@staffroom/protocol"
import { type ChangeEvent, useEffect, useState } from "react"
import { ModelPicker } from "../../components/ModelPicker.tsx"
import { Button } from "../../design/index.ts"
import { type ModelCredentialRow, api } from "../../lib/api.ts"
import { field } from "./common.tsx"

// ── Model credentials (the onboarding surface) ───────────────────────────────

export function ModelCredentials({ isAdmin }: { isAdmin: boolean }) {
  const [credentials, setCredentials] = useState<ModelCredentialRow[]>([])
  const [upstreams, setUpstreams] = useState<string[]>([])
  const [error, setError] = useState<string>()

  const reload = () => api.models.list().then(setCredentials, () => {})
  useEffect(() => {
    reload()
    api.models.upstreams().then(setUpstreams, () => {})
  }, [])

  async function remove(credential: ModelCredentialRow) {
    if (
      !confirm(`Remove “${credential.label}”? Agents using it will stop running until repointed.`)
    )
      return
    setError(undefined)
    try {
      await api.models.remove(credential.id)
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the credential.")
    }
  }

  async function rename(id: string, label: string) {
    setError(undefined)
    try {
      await api.models.rename(id, label)
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename the credential.")
    }
  }

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Model credentials</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        Connect a ChatGPT/Codex login or an upstream API key, so your agents have something to run
        on.
      </p>

      <div className="mt-6 rounded-card border border-line-default bg-surface-panel p-5">
        {credentials.length === 0 ? (
          <p className="mb-4 text-secondary text-ink-muted">None yet.</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-1">
            {credentials.map((credential) => (
              <CredentialRow
                key={credential.id}
                credential={credential}
                isAdmin={isAdmin}
                onRename={rename}
                onRemove={() => remove(credential)}
                onChanged={reload}
              />
            ))}
          </ul>
        )}

        {error && <p className="mb-3 text-secondary text-status-failed">{error}</p>}

        <ConnectCodex onDone={reload} />
        <div className="my-4 border-t border-line-subtle" />
        <AddApiKey upstreams={upstreams} onDone={reload} />
        <div className="my-4 border-t border-line-subtle" />
        <AddLocalServer onDone={reload} />
      </div>
    </section>
  )
}

/** One credential row, with inline rename (pencil → input → save/cancel). */
function CredentialRow({
  credential,
  isAdmin,
  onRename,
  onRemove,
  onChanged,
}: {
  credential: ModelCredentialRow
  isAdmin: boolean
  onRename: (id: string, label: string) => Promise<void> | void
  onRemove: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(credential.label)
  const [models, setModels] = useState<string[]>()
  const [modelsError, setModelsError] = useState<string>()
  const [checking, setChecking] = useState(false)
  const [defaulting, setDefaulting] = useState(false)
  const [defaultModel, setDefaultModel] = useState(credential.defaultModel ?? "")

  async function save() {
    const label = draft.trim()
    setEditing(false)
    if (label && label !== credential.label) await onRename(credential.id, label)
    else setDraft(credential.label)
  }

  async function checkModels() {
    setChecking(true)
    setModelsError(undefined)
    try {
      setModels(await api.models.models(credential.id))
    } catch {
      setModelsError("Could not reach the server — is it running?")
      setModels(undefined)
    } finally {
      setChecking(false)
    }
  }

  async function makeDefault() {
    if (!defaultModel.trim()) return
    try {
      await api.models.setDefault(credential.id, defaultModel.trim())
      setDefaulting(false)
      onChanged()
    } catch (caught) {
      setModelsError(caught instanceof Error ? caught.message : "Could not set the default.")
    }
  }

  return (
    <li className="flex flex-col gap-1.5 rounded-control border border-line-inset bg-surface-card px-3 py-2 text-secondary">
      <div className="flex items-center gap-3">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void save()
              if (event.key === "Escape") {
                setDraft(credential.label)
                setEditing(false)
              }
            }}
            className="min-w-40 flex-1 rounded-control border border-line-strong bg-surface-inset px-2 py-1 text-secondary text-ink-body outline-none focus:border-line-accent"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setDraft(credential.label)
                setEditing(true)
              }}
              title="Rename"
              className="text-ink-body hover:text-ink-primary"
            >
              {credential.label}
            </button>
            <span className="rounded-chip bg-surface-control px-1.5 py-0.5 text-label text-ink-secondary">
              {credential.upstream}
            </span>
            <span className="text-meta text-ink-faint">{credential.scope}</span>
            {credential.isDefault && (
              <span className="text-meta text-status-done">
                default{credential.defaultModel ? ` · ${credential.defaultModel}` : ""}
              </span>
            )}
            <span className="ml-auto font-mono text-mono text-ink-faint">{credential.hint}</span>
            {isAdmin && !credential.isDefault && (
              <button
                type="button"
                onClick={() => setDefaulting((open) => !open)}
                title="Make this the default credential agents fall back to"
                className="shrink-0 rounded-control border-0 bg-transparent text-meta text-ink-faint hover:text-ink-body"
              >
                make default
              </button>
            )}
            {credential.kind === "local" && (
              <button
                type="button"
                onClick={() => void checkModels()}
                disabled={checking}
                title="List loaded models"
                className="shrink-0 rounded-control border-0 bg-transparent text-meta text-ink-faint hover:text-ink-body"
              >
                {checking ? "checking…" : "models"}
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              title={`Remove ${credential.label}`}
              aria-label={`Remove ${credential.label}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-control border-0 bg-transparent text-ink-faint hover:text-status-failed"
            >
              <i className="ti ti-trash text-[15px]" />
            </button>
          </>
        )}
      </div>
      {defaulting && (
        <div className="flex items-center gap-2">
          <span className="text-meta text-ink-muted">Default model</span>
          <ModelPicker
            credentialId={credential.id}
            value={defaultModel}
            onChange={setDefaultModel}
            allowDefault={false}
            className="min-w-40 flex-1 rounded-control border border-line-strong bg-surface-inset px-2 py-1 text-secondary text-ink-body outline-none focus:border-line-accent"
          />
          <Button
            variant="primary"
            disabled={!defaultModel.trim()}
            onClick={() => void makeDefault()}
          >
            Set default
          </Button>
          <Button variant="ghost" onClick={() => setDefaulting(false)}>
            Cancel
          </Button>
        </div>
      )}
      {modelsError && <p className="text-meta text-status-failed">{modelsError}</p>}
      {models &&
        (models.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {models.map((model) => (
              <span
                key={model}
                className="rounded-chip bg-surface-control px-1.5 py-0.5 font-mono text-mono text-ink-secondary"
              >
                {model}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-meta text-ink-faint">No models loaded on the server.</p>
        ))}
    </li>
  )
}

function ConnectCodex({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(undefined)
    try {
      const contents = await file.text()
      await api.models.importCodex({ contents, scope: "user", label: "ChatGPT" })
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.")
    } finally {
      setBusy(false)
      event.target.value = ""
    }
  }

  return (
    <div>
      <div className="mb-1 text-secondary font-medium text-ink-secondary">
        Connect ChatGPT / Codex
      </div>
      <p className="mb-2 text-meta text-ink-muted">
        Upload the <code className="text-ink-body">auth.json</code> from{" "}
        <code className="text-ink-body">~/.codex/</code>. Stored encrypted and refreshed
        server-side.
      </p>
      <label className="inline-block cursor-pointer rounded-control bg-surface-control-hover px-3 py-1.5 text-secondary text-ink-primary hover:bg-surface-control-active">
        {busy ? "Importing…" : "Choose auth.json"}
        <input type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
      </label>
      {error && <p className="mt-2 text-secondary text-status-failed">{error}</p>}
    </div>
  )
}

function AddLocalServer({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState("LM Studio")
  const [baseUrl, setBaseUrl] = useState(LM_STUDIO_DEFAULT_BASE_URL)
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit() {
    const endpoint = baseUrl.trim()
    if (!endpoint) return
    setBusy(true)
    setError(undefined)
    try {
      const key = apiKey.trim()
      await api.models.addLocal({
        scope: "user",
        upstream: LM_STUDIO_UPSTREAM,
        label: label.trim() || "LM Studio",
        baseUrl: endpoint,
        ...(key ? { apiKey: key } : {}),
      })
      setBaseUrl(LM_STUDIO_DEFAULT_BASE_URL)
      setLabel("LM Studio")
      setApiKey("")
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-1 text-secondary font-medium text-ink-secondary">
        Or connect a local server
      </div>
      <p className="mb-2 text-meta text-ink-muted">
        Point at an <span className="text-ink-body">LM Studio</span> (or other OpenAI-compatible)
        server running on your machine. Set the model id on each agent to a model you have loaded.
        The API key is optional — leave it blank unless the server requires one.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="LM Studio"
          className={`${field} min-w-32`}
        />
        <input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={LM_STUDIO_DEFAULT_BASE_URL}
          className={`${field} min-w-56 flex-1 font-mono`}
        />
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="API key (optional)"
          className={`${field} min-w-40`}
        />
        <Button variant="primary" disabled={busy} onClick={submit}>
          Add
        </Button>
      </div>
      {error && <p className="mt-2 text-secondary text-status-failed">{error}</p>}
    </div>
  )
}

function AddApiKey({ upstreams, onDone }: { upstreams: string[]; onDone: () => void }) {
  const [upstream, setUpstream] = useState("anthropic")
  const [label, setLabel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!apiKey.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      await api.models.addApiKey({
        scope: "user",
        upstream,
        label: label || `${upstream} key`,
        apiKey: apiKey.trim(),
      })
      setApiKey("")
      setLabel("")
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-2 text-secondary font-medium text-ink-secondary">Or paste an API key</div>
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={upstream}
          onChange={(event) => setUpstream(event.target.value)}
          className={field}
        >
          {(upstreams.length > 0 ? upstreams : ["anthropic", "openai"]).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-…"
          className={`${field} min-w-48 flex-1`}
        />
        <Button variant="primary" disabled={busy} onClick={submit}>
          Add
        </Button>
      </div>
      {error && <p className="mt-2 text-secondary text-status-failed">{error}</p>}
    </div>
  )
}
