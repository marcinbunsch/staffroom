import { type ReactNode, useCallback, useEffect, useState } from "react"
import { Button } from "../../../design/index.ts"
import { type IntegrationRow, type SandboxImageStatusRow, api } from "../../../lib/api.ts"
import { field } from "../common.tsx"

/** One configured integration instance in the list, with the per-user connect. */
export function IntegrationCard({
  integration,
  isAdmin,
  teamChips,
  onConfigure,
  onRemove,
  onDisconnect,
  onSandboxBuilt,
}: {
  integration: IntegrationRow
  isAdmin: boolean
  teamChips?: ReactNode
  onConfigure: () => void
  onRemove: () => void
  onDisconnect: () => void
  /** docker kind: the image build finished, so `configured` may have flipped. */
  onSandboxBuilt?: () => void
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
        <>
          <p className="mt-1 text-meta text-ink-faint">
            {integration.repos.length} repo{integration.repos.length === 1 ? "" : "s"}
            {integration.repos.length > 0
              ? `: ${integration.repos.map((r) => r.name).join(", ")}`
              : ""}
          </p>
          {!integration.configured && (
            <SandboxImageSetup isAdmin={isAdmin} onBuilt={onSandboxBuilt} />
          )}
        </>
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
 * Why a docker instance isn't ready — the daemon, or the image — and the fix.
 * The image is buildable right here: the server runs `docker build` from its
 * bundled Dockerfile (what `pnpm sandbox:build` does), and this polls the build
 * until it lands. When the image appears the parent reloads the list, which
 * flips the card to configured.
 */
function SandboxImageSetup({ isAdmin, onBuilt }: { isAdmin: boolean; onBuilt?: () => void }) {
  const [status, setStatus] = useState<SandboxImageStatusRow>()
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.integrations.sandboxStatus())
    } catch {
      // The card's "not configured" state already says something is off.
    }
  }, [])
  useEffect(() => void refresh(), [refresh])

  const building = status?.build?.running ?? false
  useEffect(() => {
    if (!building) return
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [building, refresh])

  // The build landed — the image went from absent to present while we watched.
  // Tell the parent once, so the list refetch flips the card. Guarded on the
  // transition: an image that was already present on mount (the card is
  // unconfigured for some other reason) must not re-trigger reloads forever.
  const image = status?.image
  const [sawMissing, setSawMissing] = useState(false)
  useEffect(() => {
    if (image === false) setSawMissing(true)
    if (image === true && sawMissing) {
      setSawMissing(false)
      onBuilt?.()
    }
  }, [image, sawMissing, onBuilt])

  async function build() {
    setError(undefined)
    try {
      await api.integrations.buildSandboxImage()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the build.")
    }
  }

  if (!status) return null

  if (!status.daemon) {
    return (
      <p className="mt-2 text-meta text-status-attention">
        <i className="ti ti-alert-triangle" /> Docker daemon unreachable — start Docker, then{" "}
        <button type="button" className="underline" onClick={() => void refresh()}>
          check again
        </button>
        .
      </p>
    )
  }

  if (status.image) {
    // Built, but the boot probe hasn't flipped the card yet; the reload will.
    return (
      <p className="mt-2 text-meta text-status-done">
        <i className="ti ti-circle-check" /> Image {status.tag} present.
      </p>
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-meta text-ink-muted">
        {building
          ? `Building ${status.tag}…`
          : status.build?.failed
            ? `Building ${status.tag} failed.`
            : `The sandbox image (${status.tag}) is not built yet.`}
        {!building && !isAdmin && " Ask an admin to build it."}
      </p>
      {isAdmin && !building && (
        <div>
          <Button variant="primary" onClick={() => void build()}>
            {status.build?.failed ? "Retry build" : "Build image"}
          </Button>
        </div>
      )}
      {status.build && (building || status.build.failed) && status.build.log && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-control border border-line-default bg-surface-inset px-2.5 py-1.5 font-mono text-mono text-ink-muted">
          {status.build.log}
        </pre>
      )}
      {error && <p className="text-meta text-status-failed">{error}</p>}
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
