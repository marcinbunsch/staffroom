import { type ToolCatalogRow, type ToolCredentialRow } from "../../../lib/api.ts"
import { ConfigConnect } from "../common.tsx"

export function ToolCard({
  tool,
  isAdmin,
  orgCred,
  onConnect,
  onDisconnect,
}: {
  tool: ToolCatalogRow
  isAdmin: boolean
  orgCred?: ToolCredentialRow
  onConnect: (secret: string) => Promise<void> | void
  onDisconnect: (id: string) => Promise<void> | void
}) {
  const orgKey = tool.provisioning === "org-key"

  return (
    <div className="rounded-card border border-line-default bg-surface-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-secondary font-semibold text-ink-primary">{tool.label}</span>
        <span className="font-mono text-label text-ink-faint">{tool.name}</span>
        <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 font-mono text-label text-ink-muted">
          {tool.provisioning}
        </span>
        {tool.gated && (
          <span className="rounded-chip bg-tint-attention px-1.5 py-0.5 text-label text-status-attention">
            gated
          </span>
        )}
        {orgKey && orgCred && (
          <span className="ml-auto flex items-center gap-1.5 text-meta text-status-done">
            <i className="ti ti-circle-check" /> connected
          </span>
        )}
      </div>
      <p className="mt-1 text-meta text-ink-muted">{tool.description}</p>

      {tool.provisioning === "none" ? (
        <p className="mt-2 text-meta text-ink-faint">No credential needed.</p>
      ) : orgKey ? (
        <div className="mt-3">
          <ConfigConnect
            fields={tool.configFields}
            isAdmin={isAdmin}
            connected={Boolean(orgCred)}
            onConnect={onConnect}
            onDisconnect={() => (orgCred ? onDisconnect(orgCred.id) : undefined)}
          />
        </div>
      ) : (
        <p className="mt-2 text-meta text-ink-faint">
          Per-user connection — arrives with this integration.
        </p>
      )}
    </div>
  )
}
