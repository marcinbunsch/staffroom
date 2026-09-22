import { useCallback, useEffect, useState } from "react"
import {
  type IntegrationRow,
  type McpDiscoveredToolRow,
  type TeamRow,
  type ToolsetInputBody,
  type ToolsetRow,
  api,
} from "../../../lib/api.ts"
import { MCP_PRESETS, presetGroups, presetValues } from "./mcp-presets.ts"
import { ToolsetTeamSelect, teamsGranting, toggledSet } from "./team-select.tsx"

export function McpToolsetForm({
  existing,
  integrations,
  teams,
  onCancel,
  onSave,
  onError,
}: {
  existing?: ToolsetRow
  integrations: IntegrationRow[]
  teams: TeamRow[]
  onCancel: () => void
  onSave: (name: string, input: ToolsetInputBody, teamIds: string[]) => void
  onError: (m?: string) => void
}) {
  const [name, setName] = useState(existing?.name ?? "")
  const [label, setLabel] = useState(existing?.label ?? "")
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    new Set(teamsGranting(teams, existing && `mcp:${existing.name}`)),
  )
  const [url, setUrl] = useState(existing?.url ?? "")
  // Whether the operator has hand-typed the URL. Until they do, the field tracks
  // the selected provider's default MCP URL (and follows provider switches); once
  // typed, we never clobber it.
  const [urlTouched, setUrlTouched] = useState(false)
  const [transport, setTransport] = useState(existing?.transport ?? "streamable-http")
  // New toolsets start with no integration chosen, so nothing auto-discovers or
  // prefills until the operator picks one; an edit keeps its saved integration.
  const [integration, setIntegration] = useState(existing?.integration ?? "")
  const [discovered, setDiscovered] = useState<McpDiscoveredToolRow[]>(
    existing
      ? existing.tools.map((t) => ({ name: t, description: existing.toolDescriptions[t] ?? "" }))
      : [],
  )
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.tools ?? []))
  const [gated, setGated] = useState<Set<string>>(new Set(existing?.gatedTools ?? []))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [discovering, setDiscovering] = useState(false)
  const [preset, setPreset] = useState("")
  const toggleTeam = (id: string) => setSelectedTeams((prior) => toggledSet(prior, id))

  /** Fill the form from a known hosted server. Everything stays editable after. */
  function applyPreset(slug: string) {
    setPreset(slug)
    const chosen = MCP_PRESETS.find((p) => p.slug === slug)
    if (!chosen) return
    const values = presetValues(chosen, integrations)
    setLabel(values.label)
    setName(values.name)
    setIntegration(values.integration)
    setUrl(values.url)
    // The preset's URL is the point of picking it — keep the integration-default
    // prefill from overwriting it.
    setUrlTouched(true)
    setTransport("streamable-http")
  }

  const discover = useCallback(() => {
    if (!url.trim() || !integration) return
    onError(undefined)
    setDiscovering(true)
    api.toolsets
      .discover({ url, transport, integration })
      .then((tools) => {
        setDiscovered(tools)
        // Keep any prior selection that still exists; otherwise default to none —
        // the operator opts tools in.
        setSelected((prior) => new Set(tools.filter((t) => prior.has(t.name)).map((t) => t.name)))
      })
      .catch((caught) => onError(discoverMessage(caught)))
      .finally(() => setDiscovering(false))
  }, [url, transport, integration, onError])

  // Fetch the server's tools automatically once the URL + integration are set,
  // debounced so it fires when you finish typing rather than on every keystroke.
  useEffect(() => {
    const timer = setTimeout(discover, 500)
    return () => clearTimeout(timer)
  }, [discover])

  // Fill the server URL from the selected integration's MCP URL (its own if set,
  // else the type default — e.g. Firecrawl, HubSpot), following provider switches
  // too, but never clobbering a URL the operator typed.
  useEffect(() => {
    if (existing || urlTouched) return
    const preset = integrations.find((i) => i.name === integration)?.mcpUrl
    if (preset) setUrl(preset)
  }, [integrations, integration, existing, urlTouched])

  function save() {
    const toolDescriptions: Record<string, string> = {}
    for (const tool of discovered) {
      if (selected.has(tool.name)) toolDescriptions[tool.name] = tool.description
    }
    onSave(
      name,
      {
        label: label.trim() || name,
        kind: "mcp",
        integration,
        url,
        transport,
        tools: [...selected],
        // Only gate tools that are actually enabled.
        gatedTools: [...gated].filter((t) => selected.has(t)),
        toolDescriptions,
      },
      [...selectedTeams],
    )
  }

  const canDiscover = url.trim() && integration && !discovering
  const inputClass =
    "w-full rounded-control border border-line-strong bg-surface-inset px-2.5 py-1.5 text-secondary text-ink-body"

  return (
    <div className="rounded-card border border-line-strong bg-surface-card px-4 py-4">
      {!existing && (
        <label className="mb-3 flex flex-col gap-1 text-meta text-ink-muted">
          Start from a known server
          <select
            className={inputClass}
            value={preset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">Custom server…</option>
            {presetGroups().map(({ group, presets }) => (
              <optgroup key={group} label={group}>
                {presets.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-ink-faint">
            Fills in the fields below — the URL, a name, and the first matching integration. Edit
            anything afterwards.
          </span>
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
          Toolset name
          <input
            className={inputClass}
            value={label}
            placeholder="Gmail read-only"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Slug (grant key)
          <input
            className={inputClass}
            value={name}
            disabled={Boolean(existing)}
            placeholder="gmail-read"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Integration (auth)
          <select
            className={inputClass}
            value={integration}
            onChange={(e) => setIntegration(e.target.value)}
          >
            <option value="">Choose an integration…</option>
            {integrations
              .filter((i) => i.kind !== "docker")
              .map((i) => (
                <option key={i.name} value={i.name}>
                  {i.label}
                  {/* gcp/token are org-configured (no per-user connect); oauth
                      connects per user. */}
                  {i.kind === "gcp" || i.kind === "token"
                    ? i.configured
                      ? ""
                      : " (not configured)"
                    : i.connected
                      ? ""
                      : " (not connected)"}
                </option>
              ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
          Server URL
          <input
            className={inputClass}
            value={url}
            placeholder="https://mcp.example.com/slack"
            onChange={(e) => {
              setUrl(e.target.value)
              setUrlTouched(true)
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Transport
          <select
            className={inputClass}
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
          >
            <option value="streamable-http">streamable-http</option>
            <option value="sse">sse</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!canDiscover}
          onClick={discover}
          className="rounded-control border border-line-strong px-2.5 py-1 text-meta text-ink-body hover:bg-line-subtle disabled:opacity-50"
        >
          {discovering ? "Discovering…" : "Refresh tools"}
        </button>
        <span className="text-meta text-ink-faint">
          Tools are fetched automatically from the server; all start off — tick the ones to enable.
        </span>
      </div>

      {discovered.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-2 text-meta text-ink-muted">
            <span>Enable these tools ({selected.size} selected)</span>
            <button
              type="button"
              onClick={() => setSelected(new Set(discovered.map((t) => t.name)))}
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
          <p className="mb-1.5 text-meta text-ink-faint">
            Mark a tool <span className="text-status-attention">approval</span> to make it suspend
            for operator confirmation before each call — for outbound or irreversible actions.
          </p>
          <div className="flex max-h-64 flex-col gap-1 overflow-auto rounded-control border border-line-default p-2">
            {[...discovered]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((tool) => {
                const isOpen = expanded.has(tool.name)
                return (
                  <div key={tool.name} className="py-0.5 text-meta">
                    <div className="flex items-center gap-2">
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
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prior) => {
                              const next = new Set(prior)
                              if (next.has(tool.name)) next.delete(tool.name)
                              else next.add(tool.name)
                              return next
                            })
                          }
                          aria-expanded={isOpen}
                          className="ml-auto flex items-center gap-1 text-ink-faint hover:text-ink-body"
                        >
                          details
                          <i className={`ti ${isOpen ? "ti-chevron-up" : "ti-chevron-down"}`} />
                        </button>
                      )}
                    </div>
                    {isOpen && tool.description && (
                      <p className="mt-1 ml-6 whitespace-pre-wrap text-ink-faint">
                        {tool.description}
                      </p>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}

      <ToolsetTeamSelect teams={teams} selected={selectedTeams} onToggle={toggleTeam} />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!name.trim() || !url.trim() || !integration}
          onClick={save}
          className="rounded-control bg-accent-strong px-3 py-1.5 text-secondary font-medium text-ink-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {existing ? "Save changes" : "Add server"}
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

/** Turn a discovery failure into a legible line — the common ones are actionable. */
function discoverMessage(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught)
  if (message.includes("integration_not_connected")) {
    return "Connect your own account for that integration first (Settings → Integrations), then discover."
  }
  if (message.includes("integration_auth_failed")) {
    return "That integration is connected but its token could not be used — try reconnecting it in Settings → Integrations."
  }
  if (message.includes("discovery_failed")) {
    return "Could not reach that MCP server, or it rejected the token. Check the URL and transport."
  }
  return message
}
