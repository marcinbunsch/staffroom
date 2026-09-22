import { type ReactNode } from "react"
import {
  type ToolCatalogRow,
  type ToolCredentialRow,
  type ToolsetKindRow,
  type ToolsetRow,
} from "../../../lib/api.ts"

/** The single list of configured toolsets — built-ins and MCP toolsets together. */
export function ToolsetList({
  isAdmin,
  builtins,
  orgCredFor,
  servers,
  kinds,
  onAdd,
  onEditBuiltin,
  onEditMcp,
  onEditSandbox,
  onEditKind,
  onRemoveBuiltin,
  onRemoveToolset,
  teamChipsFor,
}: {
  isAdmin: boolean
  builtins: ToolCatalogRow[]
  orgCredFor: (tool: string) => ToolCredentialRow | undefined
  servers: ToolsetRow[]
  kinds: ToolsetKindRow[]
  onAdd: () => void
  onEditBuiltin: (tool: ToolCatalogRow) => void
  onEditMcp: (server: ToolsetRow) => void
  onEditSandbox: (server: ToolsetRow) => void
  onEditKind: (kindInfo: ToolsetKindRow, server: ToolsetRow) => void
  onRemoveBuiltin: (credId: string) => void
  onRemoveToolset: (name: string) => void
  teamChipsFor: (toolsetKey: string) => ReactNode
}) {
  // A built-in toolset is in the list once it is configured (or needs nothing).
  const configured = builtins.filter((t) => t.provisioning === "none" || orgCredFor(t.name))
  const empty = configured.length === 0 && servers.length === 0

  return (
    <>
      <div className="mt-6 flex items-center gap-2">
        <span className="text-meta text-ink-faint">
          {configured.length + servers.length} toolset
          {configured.length + servers.length === 1 ? "" : "s"}
        </span>
        {isAdmin && (
          <button
            type="button"
            onClick={onAdd}
            className="ml-auto rounded-control bg-accent-strong px-3 py-1.5 text-meta font-medium text-ink-on-accent hover:opacity-90"
          >
            <i className="ti ti-plus" /> Add toolset
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2.5">
        {empty && (
          <p className="rounded-card border border-line-default bg-surface-card px-4 py-6 text-center text-secondary text-ink-faint">
            No toolsets yet. Add one to get started.
          </p>
        )}
        {configured.map((tool) => (
          <BuiltinToolsetCard
            key={tool.name}
            tool={tool}
            isAdmin={isAdmin}
            connected={Boolean(orgCredFor(tool.name))}
            onEdit={() => onEditBuiltin(tool)}
            onRemove={() => {
              const cred = orgCredFor(tool.name)
              if (cred) onRemoveBuiltin(cred.id)
            }}
            teamChips={teamChipsFor(tool.name)}
          />
        ))}
        {servers
          .filter((s) => s.kind === "mcp")
          .map((server) => (
            <McpToolsetCard
              key={server.name}
              server={server}
              isAdmin={isAdmin}
              onEdit={() => onEditMcp(server)}
              onRemove={() => onRemoveToolset(server.name)}
              teamChips={teamChipsFor(`mcp:${server.name}`)}
            />
          ))}
        {servers
          .filter((s) => s.kind === "sandbox")
          .map((server) => (
            <SandboxToolsetCard
              key={server.name}
              server={server}
              isAdmin={isAdmin}
              onEdit={() => onEditSandbox(server)}
              onRemove={() => onRemoveToolset(server.name)}
              teamChips={teamChipsFor(`sandbox:${server.name}`)}
            />
          ))}
        {servers
          .filter((s) => s.kind !== "mcp" && s.kind !== "sandbox")
          .map((server) => (
            <KindToolsetCard
              key={server.name}
              server={server}
              kindInfo={kinds.find((k) => k.kind === server.kind)}
              isAdmin={isAdmin}
              onEdit={(kindInfo) => onEditKind(kindInfo, server)}
              onRemove={() => onRemoveToolset(server.name)}
              teamChips={teamChipsFor(`${server.kind}:${server.name}`)}
            />
          ))}
      </div>
    </>
  )
}

/** A plugin-kind toolset row (a stored toolset whose kind came from a plugin). */
function KindToolsetCard({
  server,
  kindInfo,
  isAdmin,
  onEdit,
  onRemove,
  teamChips,
}: {
  server: ToolsetRow
  kindInfo?: ToolsetKindRow
  isAdmin: boolean
  onEdit: (kindInfo: ToolsetKindRow) => void
  onRemove: () => void
  teamChips?: ReactNode
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-secondary font-semibold text-ink-primary">{server.label}</span>
        <span className="font-mono text-label text-ink-faint">{server.name}</span>
        <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
          {kindInfo?.label ?? server.kind}
        </span>
        {server.integration && (
          <span className="text-meta text-ink-faint">via {server.integration}</span>
        )}
        {server.tools.length > 0 && (
          <span className="text-meta text-ink-faint">
            {server.tools.length} tool{server.tools.length === 1 ? "" : "s"} enabled
          </span>
        )}
        {server.gatedTools.length > 0 && (
          <span className="flex items-center gap-1 text-meta text-status-attention">
            <i className="ti ti-shield-lock" /> {server.gatedTools.length} need approval
          </span>
        )}
        {isAdmin && (
          <div className="ml-auto flex items-center gap-1.5">
            {/* Editing needs the kind's form metadata; if the plugin that
                registered this kind is no longer loaded, only removal is offered. */}
            {kindInfo && (
              <button
                type="button"
                onClick={() => onEdit(kindInfo)}
                className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-ink-body hover:bg-line-subtle"
              >
                Reconfigure
              </button>
            )}
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
      {server.url && <p className="mt-1 font-mono text-meta text-ink-faint">{server.url}</p>}
      {teamChips}
    </div>
  )
}

/** A Docker Sandbox toolset row: which integration (repos) it mounts. */
function SandboxToolsetCard({
  server,
  isAdmin,
  onEdit,
  onRemove,
  teamChips,
}: {
  server: ToolsetRow
  isAdmin: boolean
  onEdit: () => void
  onRemove: () => void
  teamChips?: ReactNode
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-secondary font-semibold text-ink-primary">{server.label}</span>
        <span className="font-mono text-label text-ink-faint">{server.name}</span>
        <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
          Docker Sandbox
        </span>
        <span className="text-meta text-ink-faint">via {server.integration}</span>
        {isAdmin && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-ink-body hover:bg-line-subtle"
            >
              Reconfigure
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
      {teamChips}
    </div>
  )
}

/** A configured built-in toolset row in the list (Firecrawl, …). */
function BuiltinToolsetCard({
  tool,
  isAdmin,
  connected,
  onEdit,
  onRemove,
  teamChips,
}: {
  tool: ToolCatalogRow
  isAdmin: boolean
  connected: boolean
  onEdit: () => void
  onRemove: () => void
  teamChips?: ReactNode
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-secondary font-semibold text-ink-primary">{tool.label}</span>
        <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
          built-in
        </span>
        {connected && (
          <span className="flex items-center gap-1.5 text-meta text-status-done">
            <i className="ti ti-circle-check" /> configured
          </span>
        )}
        {isAdmin && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-ink-body hover:bg-line-subtle"
            >
              Configure
            </button>
            {connected && (
              <button
                type="button"
                onClick={onRemove}
                className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-status-failed hover:bg-tint-attention"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mt-1 text-meta text-ink-muted">{tool.description}</p>
      {teamChips}
    </div>
  )
}

function McpToolsetCard({
  server,
  isAdmin,
  onEdit,
  onRemove,
  teamChips,
}: {
  server: ToolsetRow
  isAdmin: boolean
  onEdit: () => void
  onRemove: () => void
  teamChips?: ReactNode
}) {
  return (
    <div className="rounded-card border border-line-default bg-surface-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-secondary font-semibold text-ink-primary">{server.label}</span>
        <span className="font-mono text-label text-ink-faint">{server.name}</span>
        <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
          via {server.integration}
        </span>
        <span className="text-meta text-ink-faint">
          {server.tools.length} tool{server.tools.length === 1 ? "" : "s"} enabled
        </span>
        {server.gatedTools.length > 0 && (
          <span className="flex items-center gap-1 text-meta text-status-attention">
            <i className="ti ti-shield-lock" /> {server.gatedTools.length} need approval
          </span>
        )}
        {isAdmin && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-ink-body hover:bg-line-subtle"
            >
              Reconfigure
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
      <p className="mt-1 font-mono text-meta text-ink-faint">{server.url}</p>
      {teamChips}
    </div>
  )
}
