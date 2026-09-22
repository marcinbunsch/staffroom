import { type ReactNode, useState } from "react"
import { Button } from "../../../design/index.ts"
import { type IntegrationRow, api } from "../../../lib/api.ts"
import { field } from "../common.tsx"

/** One configured integration instance in the list, with the per-user connect. */
export function IntegrationCard({
  integration,
  isAdmin,
  teamChips,
  onConfigure,
  onRemove,
  onDisconnect,
}: {
  integration: IntegrationRow
  isAdmin: boolean
  teamChips?: ReactNode
  onConfigure: () => void
  onRemove: () => void
  onDisconnect: () => void
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface-card px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-primary">{integration.label}</span>
        <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
          {integration.type}
        </span>
        {integration.configured ? (
          <span className="flex items-center gap-1.5 text-meta text-status-done">
            <i className="ti ti-circle-check" /> configured
          </span>
        ) : (
          <span className="text-meta text-status-attention">not configured</span>
        )}
        {isAdmin && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onConfigure}
              className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-ink-body hover:bg-line-subtle"
            >
              Configure
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-status-failed hover:bg-tint-attention"
            >
              Remove
            </button>
          </div>
        )}
      </div>
      {integration.kind === "docker" ? (
        <p className="mt-1 text-meta text-ink-faint">
          {integration.repos.length} repo{integration.repos.length === 1 ? "" : "s"}
          {integration.repos.length > 0
            ? `: ${integration.repos.map((r) => r.name).join(", ")}`
            : ""}
          {!integration.configured && " · Docker daemon or image not available"}
        </p>
      ) : integration.kind === "token" ? (
        <p className="mt-1 text-meta text-ink-faint">
          {integration.configured ? "API key stored" : "Add an API key to configure"}
          {integration.mcpUrl ? ` · MCP ${integration.mcpUrl}` : ""}
        </p>
      ) : integration.kind === "mcp" ? (
        <p className="mt-1 text-meta text-ink-faint">
          Auto-discovered MCP{integration.mcpUrl ? ` · ${integration.mcpUrl}` : ""}
        </p>
      ) : (
        <p className="mt-1 text-meta text-ink-faint">
          Scopes: {integration.scopes.join(", ") || "—"}
        </p>
      )}

      {(integration.kind === "oauth" || integration.kind === "mcp") && integration.configured && (
        <div className="mt-3 border-t border-line-subtle pt-3">
          <div className="mb-2 text-label uppercase tracking-[0.6px] text-ink-label">
            Your account
          </div>
          {integration.connected && integration.stale ? (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-meta text-status-attention">
                <i className="ti ti-alert-triangle" /> needs reconnect &mdash; {integration.label}{" "}
                rejected your authorization
              </span>
              <div className="flex items-center gap-3">
                <ConnectAccount name={integration.name} label={integration.label} reconnect />
                <Button variant="danger" onClick={onDisconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          ) : integration.connected ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-meta text-status-done">
                <i className="ti ti-circle-check" /> connected
              </span>
              <Button variant="danger" onClick={onDisconnect}>
                Disconnect
              </Button>
            </div>
          ) : (
            <ConnectAccount name={integration.name} label={integration.label} />
          )}
        </div>
      )}

      {teamChips}
    </div>
  )
}

/**
 * Start a per-user OAuth connect. Fetches the consent URL, then offers to open
 * it here or copy it — the latter for when you are signed into the provider in a
 * different browser. Either way the flow is bound to you (the state carries your
 * id), so whichever browser finishes it connects your account.
 */
function ConnectAccount({
  name,
  label,
  reconnect,
}: {
  name: string
  label: string
  reconnect?: boolean
}) {
  const [authUrl, setAuthUrl] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string>()

  async function start() {
    setError(undefined)
    try {
      const result = await api.integrations.connect(name)
      setAuthUrl(result.authUrl)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the connect.")
    }
  }

  if (!authUrl) {
    return (
      <div>
        <Button variant="primary" onClick={() => void start()}>
          {reconnect ? "Reconnect" : "Connect"} {label}
        </Button>
        {error && <p className="mt-2 text-meta text-status-failed">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-meta text-ink-muted">
        Open the consent page here, or copy the link to finish in the browser where you&rsquo;re
        signed into {label}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => (window.location.href = authUrl)}>
          Open
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(authUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <input
        readOnly
        value={authUrl}
        onFocus={(event) => event.currentTarget.select()}
        className={`${field} font-mono text-mono`}
      />
    </div>
  )
}
