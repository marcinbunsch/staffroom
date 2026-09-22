import { useCallback, useEffect, useState } from "react"
import {
  type IntegrationRow,
  type McpDiscoveredToolRow,
  type TeamRow,
  type ToolsetInputBody,
  type ToolsetKindRow,
  type ToolsetRow,
  api,
} from "../../../lib/api.ts"
import { ToolsetTeamSelect, teamsGranting, toggledSet } from "./team-select.tsx"

/**
 * The generic register/edit form for a plugin-contributed toolset kind. Built-in
 * kinds (mcp, sandbox) have bespoke forms; this drives any other kind from its
 * declared metadata — a name, a label, and a URL and/or an integration only when
 * the kind says it uses them.
 *
 * A kind that exposes tools gets a picker, so an admin installs the subset they
 * want (the same "enable 2 of 5" flow as MCP), and can mark any of them for
 * per-call operator approval.
 */
export function PluginToolsetForm({
  kindInfo,
  existing,
  integrations,
  teams,
  onCancel,
  onSave,
  onError,
}: {
  kindInfo: ToolsetKindRow
  existing?: ToolsetRow
  integrations: IntegrationRow[]
  teams: TeamRow[]
  onCancel: () => void
  onSave: (name: string, input: ToolsetInputBody, teamIds: string[]) => void
  onError: (m?: string) => void
}) {
  const [name, setName] = useState(existing?.name ?? "")
  const [label, setLabel] = useState(existing?.label ?? "")
  const [url, setUrl] = useState(existing?.url ?? "")
  const [integration, setIntegration] = useState(existing?.integration ?? "")
  const [available, setAvailable] = useState<McpDiscoveredToolRow[]>(
    existing
      ? existing.tools.map((t) => ({ name: t, description: existing.toolDescriptions[t] ?? "" }))
      : [],
  )
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.tools ?? []))
  const [gated, setGated] = useState<Set<string>>(new Set(existing?.gatedTools ?? []))
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    new Set(teamsGranting(teams, existing && `${kindInfo.kind}:${existing.name}`)),
  )
  const toggleTeam = (id: string) => setSelectedTeams((prior) => toggledSet(prior, id))

  const loadTools = useCallback(() => {
    if (kindInfo.usesUrl && !url.trim()) return
    if (kindInfo.usesIntegration && !integration) return
    onError(undefined)
    api.toolsets
      .kindTools({
        kind: kindInfo.kind,
        url: url || undefined,
        integration: integration || undefined,
      })
      .then((tools) => {
        setAvailable(tools)
        setSelected((prior) => {
          // A new toolset enables everything by default (a plugin's tools are
          // curated); an edit keeps the prior selection that still exists.
          if (!existing) return new Set(tools.map((t) => t.name))
          return new Set(tools.filter((t) => prior.has(t.name)).map((t) => t.name))
        })
      })
      .catch((caught) =>
        onError(caught instanceof Error ? caught.message : "Could not load tools."),
      )
  }, [
    kindInfo.kind,
    kindInfo.usesUrl,
    kindInfo.usesIntegration,
    url,
    integration,
    existing,
    onError,
  ])

  // Load the kind's tools when the config it depends on is ready, debounced.
  useEffect(() => {
    const timer = setTimeout(loadTools, 400)
    return () => clearTimeout(timer)
  }, [loadTools])

  const inputClass =
    "w-full rounded-control border border-line-strong bg-surface-inset px-2.5 py-1.5 text-secondary text-ink-body"

  const ready =
    Boolean(name.trim()) &&
    Boolean(label.trim()) &&
    (!kindInfo.usesUrl || Boolean(url.trim())) &&
    (!kindInfo.usesIntegration || Boolean(integration)) &&
    (available.length === 0 || selected.size > 0)

  function save() {
    const toolDescriptions: Record<string, string> = {}
    for (const tool of available) {
      if (selected.has(tool.name)) toolDescriptions[tool.name] = tool.description
    }
    onSave(
      name,
      {
        label: label.trim() || name,
        kind: kindInfo.kind,
        integration: kindInfo.usesIntegration ? integration : "",
        url: kindInfo.usesUrl ? url.trim() : undefined,
        tools: [...selected],
        gatedTools: [...gated].filter((t) => selected.has(t)),
        toolDescriptions,
      },
      [...selectedTeams],
    )
  }

  return (
    <div className="rounded-card border border-line-strong bg-surface-card px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Name
          <input
            className={inputClass}
            value={label}
            placeholder={kindInfo.label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Slug (grant key)
          <input
            className={inputClass}
            value={name}
            disabled={Boolean(existing)}
            placeholder="team-notes"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {kindInfo.usesUrl && (
          <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
            URL
            <input
              className={inputClass}
              value={url}
              placeholder="https://…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
        )}
        {kindInfo.usesIntegration && (
          <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
            Integration
            <select
              className={inputClass}
              value={integration}
              onChange={(e) => setIntegration(e.target.value)}
            >
              <option value="">Select an integration…</option>
              {integrations.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {kindInfo.description && (
        <p className="mt-2 text-meta text-ink-faint">{kindInfo.description}</p>
      )}

      {available.length === 0 && kindInfo.usesUrl && !url.trim() && (
        <p className="mt-3 text-meta text-ink-faint">Enter a URL to load this toolset's tools.</p>
      )}
      {available.length === 0 && kindInfo.usesIntegration && !integration && (
        <p className="mt-3 text-meta text-ink-faint">
          Choose an integration to load this toolset's tools.
        </p>
      )}

      {available.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 text-meta text-ink-muted">
            <span>Enable these tools ({selected.size} selected)</span>
            <button
              type="button"
              onClick={() => setSelected(new Set(available.map((t) => t.name)))}
              className="text-ink-link hover:underline"
            >
              all
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-ink-link hover:underline"
            >
              none
            </button>
          </div>
          <div className="flex max-h-64 flex-col gap-1 overflow-auto rounded-control border border-line-default p-2">
            {[...available]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((tool) => (
                <div key={tool.name} className="flex items-center gap-2 py-0.5 text-meta">
                  <input
                    type="checkbox"
                    checked={selected.has(tool.name)}
                    onChange={(e) =>
                      setSelected((prior) => {
                        const next = new Set(prior)
                        if (e.target.checked) next.add(tool.name)
                        else next.delete(tool.name)
                        return next
                      })
                    }
                  />
                  <span className="font-mono text-ink-body">{tool.name}</span>
                  {selected.has(tool.name) && (
                    <button
                      type="button"
                      onClick={() => setGated((prior) => toggledSet(prior, tool.name))}
                      title="Require operator approval before each call"
                      className={`rounded-chip border px-1.5 py-0.5 text-label ${
                        gated.has(tool.name)
                          ? "border-status-attention text-status-attention"
                          : "border-line-strong text-ink-faint hover:bg-line-subtle"
                      }`}
                    >
                      <i className="ti ti-shield-lock" /> approval
                    </button>
                  )}
                  {tool.description && (
                    <span className="ml-auto truncate text-ink-faint" title={tool.description}>
                      {tool.description}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}

      <ToolsetTeamSelect teams={teams} selected={selectedTeams} onToggle={toggleTeam} />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={save}
          className="rounded-control bg-accent-strong px-3 py-1.5 text-secondary font-medium text-ink-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {existing ? "Save changes" : `Add ${kindInfo.label} toolset`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control px-3 py-1.5 text-secondary text-ink-muted hover:text-ink-body"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
