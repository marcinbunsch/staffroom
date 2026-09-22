import { type ToolCatalogRow, type ToolsetKindRow } from "../../../lib/api.ts"
import { BackLink, PickCard } from "../common.tsx"

/** The "Add a toolset" type picker: a built-in type, MCP, Docker Sandbox, or a plugin kind. */
export function ToolsetPicker({
  builtins,
  pluginKinds,
  hasDockerSandbox,
  onBack,
  onPickBuiltin,
  onPickMcp,
  onPickSandbox,
  onPickKind,
}: {
  builtins: ToolCatalogRow[]
  pluginKinds: ToolsetKindRow[]
  hasDockerSandbox: boolean
  onBack: () => void
  onPickBuiltin: (tool: ToolCatalogRow) => void
  onPickMcp: () => void
  onPickSandbox: () => void
  onPickKind: (kind: ToolsetKindRow) => void
}) {
  return (
    <div className="mt-6">
      <BackLink onClick={onBack} label="Add a toolset" />
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {builtins.map((tool) => (
          <PickCard
            key={tool.name}
            icon="ti-plug"
            title={tool.label}
            description={tool.description}
            onClick={() => onPickBuiltin(tool)}
          />
        ))}
        <PickCard
          icon="ti-server"
          title="MCP"
          description="Pick a set of tools from any MCP server (Slack, Gmail, Notion, …)."
          onClick={onPickMcp}
        />
        {hasDockerSandbox && (
          <PickCard
            icon="ti-box"
            title="Docker Sandbox"
            description="A shell + filesystem (read/write/edit/bash/grep/glob) backed by a Docker Sandbox integration's repos."
            onClick={onPickSandbox}
          />
        )}
        {pluginKinds.map((kindInfo) => (
          <PickCard
            key={kindInfo.kind}
            icon="ti-puzzle"
            title={kindInfo.label}
            description={kindInfo.description || `A ${kindInfo.kind} toolset (from a plugin).`}
            onClick={() => onPickKind(kindInfo)}
          />
        ))}
      </div>
      {!hasDockerSandbox && (
        <p className="mt-2 text-meta text-ink-faint">
          Add a Docker Sandbox integration first to offer a sandbox toolset.
        </p>
      )}
    </div>
  )
}
