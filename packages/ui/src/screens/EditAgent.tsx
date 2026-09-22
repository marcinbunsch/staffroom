import { type FormEvent, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { ModelPicker } from "../components/ModelPicker.tsx"
import { Button } from "../design/index.ts"
import {
  type ModelCredentialRow,
  type StaffRow,
  type ToolCatalogRow,
  type ToolCredentialRow,
  type ToolsetRow,
  api,
} from "../lib/api.ts"

/**
 * Edit an agent: its name, role description, system prompt, model, which credential pays for it,
 * and — the part that closes the tool loop — which catalog tools it is granted.
 * Built on PATCH /api/staff/:id; delete removes the agent.
 */
export function EditAgent({ roster, onChanged }: { roster: StaffRow[]; onChanged: () => void }) {
  const navigate = useNavigate()
  const { agentId } = useParams()
  const member = roster.find((row) => row.id === agentId)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [systemPrompt, setSystemPrompt] = useState("")
  const [model, setModel] = useState("")
  const [credentialId, setCredentialId] = useState("")
  const [tools, setTools] = useState<string[]>([])
  const [credentials, setCredentials] = useState<ModelCredentialRow[]>([])
  const [catalog, setCatalog] = useState<ToolCatalogRow[]>([])
  const [orgCreds, setOrgCreds] = useState<ToolCredentialRow[]>([])
  const [toolsets, setToolsets] = useState<ToolsetRow[]>([])
  const [granted, setGranted] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!member) return
    setName(member.name)
    setDescription(member.description)
    setSystemPrompt(member.systemPrompt)
    setModel(member.model ?? "")
    setCredentialId(member.credentialId ?? "")
    setTools(member.tools)
  }, [member])

  useEffect(() => {
    api.models.list().then(setCredentials, () => {})
    api.tools.catalog().then(setCatalog, () => {})
    api.tools.credentials().then(setOrgCreds, () => setOrgCreds([]))
    api.toolsets.list().then(setToolsets, () => setToolsets([]))
    api.teams.myGrants().then(
      (keys) => setGranted(new Set(keys)),
      () => setGranted(new Set()),
    )
  }, [])

  // A built-in toolset is grantable only once it exists — i.e. it needs no
  // credential, or its org key is configured. An unconfigured Firecrawl is not
  // yet a toolset, so it should not appear as a choice.
  const builtinToolsets = catalog.filter(
    (tool) =>
      tool.provisioning === "none" ||
      orgCreds.some((c) => c.tool === tool.name && c.scope === "org"),
  )

  // Only offer toolsets the owner's teams actually grant — offering an ungranted
  // one is a dead choice (it can't attach at runtime). The exception is one still
  // selected on this agent: keep it visible, tagged, so a lost grant is obvious
  // and can be removed. Everything else the caller has no access to is hidden.
  const accessible = (key: string) => granted.has(key) || tools.includes(key)
  // A grant is `<kind>:<name>` — the kind is the toolset's own, so a built-in
  // (mcp, sandbox) and any plugin-contributed kind are all granted the same way.
  const grantKeyOf = (server: ToolsetRow) => `${server.kind}:${server.name}`
  const visibleBuiltins = builtinToolsets.filter((tool) => accessible(tool.name))
  const visibleToolsets = toolsets.filter((server) => accessible(grantKeyOf(server)))

  if (!agentId) return null
  if (!member) return <div className="p-6 text-secondary text-ink-muted">No agent “{agentId}”.</div>

  function toggleTool(nameOfTool: string) {
    setTools((current) =>
      current.includes(nameOfTool)
        ? current.filter((t) => t !== nameOfTool)
        : [...current, nameOfTool],
    )
  }

  async function save() {
    setBusy(true)
    setError(undefined)
    try {
      await api.staff.update(agentId!, {
        name: name.trim() || agentId,
        description: description.trim(),
        systemPrompt,
        model: model.trim() || null,
        credentialId: credentialId || null,
        tools,
      })
      onChanged()
      navigate(`/a/${agentId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the agent.")
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete agent “${member?.name}”? Its chats and jobs stay, but it can't be run.`))
      return
    await api.staff.remove(agentId!)
    onChanged()
    navigate("/")
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          void save()
        }}
        className="mx-auto flex max-w-xl flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <h1 className="self-start text-title font-semibold tracking-[-0.3px]">
            Edit {member.name}
          </h1>
          <span className="font-mono text-mono text-ink-faint">{agentId}</span>
        </div>

        <Field label="Name">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Role description" hint="shown to other agents when they choose who to ask">
          <textarea
            className={`${input} min-h-20`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={280}
            placeholder="Keeps production systems reliable and handles incidents."
          />
        </Field>

        <Field label="System prompt">
          <textarea
            className={`${input} min-h-28`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
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
              onChange={(e) => setCredentialId(e.target.value)}
            >
              <option value="">Default credential</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.upstream})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <span className="mb-2 block text-label text-ink-muted uppercase tracking-[0.6px]">
            Toolsets
          </span>
          <div className="flex flex-col gap-1.5 rounded-card border border-line-default bg-surface-card p-3">
            {visibleBuiltins.length === 0 && visibleToolsets.length === 0 && (
              <span className="text-meta text-ink-faint">
                No toolsets your teams grant — grant some in Settings → Teams.
              </span>
            )}
            {visibleBuiltins.map((tool) => (
              <label
                key={tool.name}
                className="flex cursor-pointer items-start gap-2.5 text-secondary"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={tools.includes(tool.name)}
                  onChange={() => toggleTool(tool.name)}
                />
                <span className="min-w-0">
                  <span className="text-ink-body">{tool.label}</span>
                  <span className="ml-2 font-mono text-meta text-ink-faint">{tool.name}</span>
                  {tool.gated && (
                    <span className="ml-2 text-meta text-status-attention">gated</span>
                  )}
                  {!granted.has(tool.name) && <TeamGateTag />}
                  <span className="block text-meta text-ink-faint">{tool.description}</span>
                </span>
              </label>
            ))}
            {visibleToolsets.map((server) => {
              const grant = grantKeyOf(server)
              return (
                <label
                  key={server.name}
                  className="flex cursor-pointer items-start gap-2.5 text-secondary"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={tools.includes(grant)}
                    onChange={() => toggleTool(grant)}
                  />
                  <span className="min-w-0">
                    <span className="text-ink-body">{server.label}</span>
                    <span className="ml-2 rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
                      {server.kind === "sandbox"
                        ? "Docker Sandbox"
                        : server.kind === "mcp"
                          ? "MCP"
                          : server.kind}
                    </span>
                    {!granted.has(grant) && <TeamGateTag />}
                    <span className="block text-meta text-ink-faint">
                      {server.kind === "mcp"
                        ? server.tools.join(", ")
                        : server.integration
                          ? `via ${server.integration}`
                          : (server.url ?? "")}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {error && <p className="text-secondary text-status-failed">{error}</p>}

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => navigate(`/a/${agentId}`)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="danger" className="ml-auto" onClick={() => void remove()}>
            Delete agent
          </Button>
        </div>
      </form>
    </div>
  )
}

/** Marks a toolset that no team the owner is on grants — so it can't be enabled. */
function TeamGateTag() {
  return (
    <span
      className="ml-2 rounded-chip border border-line-strong px-1.5 py-0.5 text-label text-ink-faint"
      title="No team you're on grants this toolset. Grant it to a team in Settings → Teams to enable it."
    >
      not granted by your teams
    </span>
  )
}

const input =
  "w-full rounded-control border border-line-strong bg-surface-inset px-3 py-2 text-secondary text-ink-body outline-none focus:border-line-accent"

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
    <label className="block flex-1">
      <span className="mb-1 block text-label text-ink-muted uppercase tracking-[0.6px]">
        {label}
        {hint && <span className="ml-1 normal-case text-ink-faint">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}
