import { useCallback, useEffect, useState } from "react"
import { Button } from "../../design/index.ts"
import { api } from "../../lib/api.ts"
import { timeAgo } from "../../lib/format.ts"

type KeyRow = Awaited<ReturnType<typeof api.keys.list>>[number]

/**
 * Personal API keys — mint one to authenticate the CLI (or any non-browser
 * client) as yourself. The full key is shown once, right after creation; only a
 * short identifier is kept afterwards. Backed by the better-auth apiKey plugin.
 */
export function ApiKeysSection() {
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [name, setName] = useState("")
  const [created, setCreated] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const reload = useCallback(() => {
    api.keys.list().then(setKeys, () => setKeys([]))
  }, [])
  useEffect(() => reload(), [reload])

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const key = await api.keys.create(name.trim())
      setCreated(key.key)
      setName("")
      reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the key.")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(row: KeyRow) {
    if (!confirm(`Revoke “${row.name ?? row.id}”? Any client using it stops working.`)) return
    await api.keys.remove(row.id)
    setKeys((current) => current.filter((k) => k.id !== row.id))
  }

  const inputClass =
    "rounded-control border border-line-strong bg-surface-inset px-3 py-2 text-secondary text-ink-body outline-none focus:border-line-accent"

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">API keys</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        Mint a key to use the CLI as yourself. Send it in the <code>x-api-key</code> header. The
        full key is shown once, on creation — store it somewhere safe.
      </p>

      {error && <p className="mt-4 text-secondary text-status-failed">{error}</p>}

      {created && (
        <div className="mt-4 rounded-card border border-status-attention bg-tint-attention px-4 py-3">
          <p className="text-meta text-ink-body">Copy this now — it won’t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={created}
              className={`${inputClass} flex-1 font-mono text-mono`}
            />
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(created)}
            >
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setCreated(undefined)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          className={`${inputClass} flex-1`}
          value={name}
          placeholder="Key name — e.g. laptop CLI"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void create()}
        />
        <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? "Creating…" : "Create key"}
        </Button>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {keys.length === 0 ? (
          <p className="text-secondary text-ink-faint">No API keys yet.</p>
        ) : (
          keys.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-2 rounded-card border border-line-default bg-surface-card px-4 py-3"
            >
              <span className="text-secondary font-semibold text-ink-primary">
                {row.name ?? "(unnamed)"}
              </span>
              {row.start && (
                <span className="font-mono text-label text-ink-faint">{row.start}…</span>
              )}
              <span className="text-meta text-ink-faint">created {timeAgo(row.createdAt)}</span>
              {row.lastRequest && (
                <span className="text-meta text-ink-faint">
                  · last used {timeAgo(row.lastRequest)}
                </span>
              )}
              <button
                type="button"
                onClick={() => void revoke(row)}
                className="ml-auto rounded-control border border-line-strong px-2 py-0.5 text-meta text-status-failed hover:bg-tint-attention"
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
