import { useCallback, useEffect, useState } from "react"
import { type IntegrationRow, type TeamRow, api } from "../../lib/api.ts"
import { auth } from "../../lib/auth.ts"
import { type AdminUser, BackLink } from "./common.tsx"

// ── Teams (tool-grant authorization) ─────────────────────────────────────────

interface GrantableToolset {
  key: string
  label: string
  kind: string
}

/**
 * Teams grant toolsets to their members' agents. A user's agents may use the
 * union of their teams' toolsets; a user on no team gets none (the restrictive
 * default). Built-in tools are always available and are not listed here.
 */
export function TeamsSection() {
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [grantable, setGrantable] = useState<GrantableToolset[]>([])
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([])
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<TeamRow | undefined>()
  const [newName, setNewName] = useState("")

  const reload = useCallback(() => {
    api.teams.list().then(setTeams, () => setTeams([]))
  }, [])
  useEffect(() => reload(), [reload])

  useEffect(() => {
    auth.admin.listUsers({ query: { limit: 200 } }).then(
      (result) =>
        setUsers(((result.data as { users?: AdminUser[] } | null)?.users ?? []) as AdminUser[]),
      () => setUsers([]),
    )
    // Grantable toolsets: configured built-ins plus MCP toolsets, keyed the way
    // an agent's grants are (`tool_name` or `mcp:<slug>`).
    Promise.all([api.tools.catalog(), api.toolsets.list(), api.tools.credentials()]).then(
      ([tools, toolsets, creds]) => {
        const builtins = tools
          .filter(
            (t) =>
              t.provisioning === "none" ||
              creds.some((c) => c.tool === t.name && c.scope === "org"),
          )
          .map((t) => ({ key: t.name, label: t.label, kind: "built-in" }))
        const mcp = toolsets
          .filter((s) => s.kind === "mcp")
          .map((s) => ({ key: `mcp:${s.name}`, label: s.label, kind: "MCP" }))
        const sandboxes = toolsets
          .filter((s) => s.kind === "sandbox")
          .map((s) => ({ key: `sandbox:${s.name}`, label: s.label, kind: "Docker Sandbox" }))
        setGrantable([...builtins, ...mcp, ...sandboxes])
      },
      () => setGrantable([]),
    )
    api.integrations.list().then(setIntegrations, () => setIntegrations([]))
  }, [])

  async function run(work: () => Promise<unknown>): Promise<boolean> {
    setError(undefined)
    try {
      await work()
      reload()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.")
      return false
    }
  }

  if (editing) {
    return (
      <TeamEditor
        team={editing}
        users={users}
        grantable={grantable}
        integrations={integrations}
        error={error}
        onCancel={() => {
          setError(undefined)
          setEditing(undefined)
        }}
        onDelete={() =>
          run(() => api.teams.remove(editing.id)).then((ok) => {
            if (ok) setEditing(undefined)
          })
        }
        onSave={async (name, members, grants, integrationGrants) => {
          const ok = await run(async () => {
            if (name !== editing.name) await api.teams.rename(editing.id, name)
            await api.teams.setMembers(editing.id, members)
            await api.teams.setGrants(editing.id, grants)
            await api.teams.setIntegrationGrants(editing.id, integrationGrants)
          })
          if (ok) setEditing(undefined)
        }}
      />
    )
  }

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Teams</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        A team grants toolsets to its members. A member's agents may use the union of their teams'
        toolsets — a user on no team gets none. Built-in tools always work.
      </p>

      {error && <p className="mt-4 text-secondary text-status-failed">{error}</p>}

      <div className="mt-6 flex gap-2">
        <input
          className="flex-1 rounded-control border border-line-strong bg-surface-inset px-2.5 py-1.5 text-secondary text-ink-body"
          placeholder="New team name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={() =>
            run(() => api.teams.create(newName.trim())).then((ok) => {
              if (ok) setNewName("")
            })
          }
          className="rounded-control bg-accent-strong px-3 py-1.5 text-secondary font-medium text-ink-on-accent hover:opacity-90 disabled:opacity-50"
        >
          Create team
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2.5">
        {teams.length === 0 && <p className="text-meta text-ink-faint">No teams yet.</p>}
        {teams.map((team) => (
          <div
            key={team.id}
            className="flex items-center gap-2 rounded-card border border-line-default bg-surface-card px-4 py-3.5"
          >
            <span className="font-semibold text-ink-primary">{team.name}</span>
            <span className="text-meta text-ink-faint">
              {team.members.length} member{team.members.length === 1 ? "" : "s"} ·{" "}
              {team.grants.length} toolset{team.grants.length === 1 ? "" : "s"} ·{" "}
              {team.integrationGrants.length} integration
              {team.integrationGrants.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setEditing(team)}
              className="ml-auto rounded-control border border-line-strong px-2 py-0.5 text-meta text-ink-body hover:bg-line-subtle"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => run(() => api.teams.remove(team.id))}
              className="rounded-control border border-line-strong px-2 py-0.5 text-meta text-status-failed hover:bg-tint-attention"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function TeamEditor({
  team,
  users,
  grantable,
  integrations,
  error,
  onSave,
  onCancel,
  onDelete,
}: {
  team: TeamRow
  users: AdminUser[]
  grantable: GrantableToolset[]
  integrations: IntegrationRow[]
  error?: string
  onSave: (name: string, members: string[], grants: string[], integrationGrants: string[]) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(team.name)
  const [members, setMembers] = useState<Set<string>>(new Set(team.members))
  const [grants, setGrants] = useState<Set<string>>(new Set(team.grants))
  const [integrationGrants, setIntegrationGrants] = useState<Set<string>>(
    new Set(team.integrationGrants),
  )

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  return (
    <section>
      <BackLink onClick={onCancel} label="Teams" />
      <input
        className="mt-4 w-full rounded-control border border-line-strong bg-surface-inset px-2.5 py-1.5 text-heading font-semibold text-ink-primary"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      {error && <p className="mt-3 text-secondary text-status-failed">{error}</p>}

      <div className="mt-5">
        <span className="mb-2 block text-label uppercase tracking-[0.6px] text-ink-muted">
          Members
        </span>
        <div className="flex flex-col gap-1.5 rounded-card border border-line-default bg-surface-card p-3">
          {users.length === 0 && <span className="text-meta text-ink-faint">No accounts.</span>}
          {users.map((user) => (
            <label
              key={user.id}
              className="flex cursor-pointer items-center gap-2.5 text-secondary"
            >
              <input
                type="checkbox"
                checked={members.has(user.id)}
                onChange={() => setMembers((s) => toggle(s, user.id))}
              />
              <span className="text-ink-body">{user.email}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <span className="mb-2 block text-label uppercase tracking-[0.6px] text-ink-muted">
          Toolsets
        </span>
        <div className="flex flex-col gap-1.5 rounded-card border border-line-default bg-surface-card p-3">
          {grantable.length === 0 && (
            <span className="text-meta text-ink-faint">
              No toolsets yet — add one in Settings → Toolsets.
            </span>
          )}
          {grantable.map((toolset) => (
            <label
              key={toolset.key}
              className="flex cursor-pointer items-center gap-2.5 text-secondary"
            >
              <input
                type="checkbox"
                checked={grants.has(toolset.key)}
                onChange={() => setGrants((s) => toggle(s, toolset.key))}
              />
              <span className="text-ink-body">{toolset.label}</span>
              <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
                {toolset.kind}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <span className="mb-2 block text-label uppercase tracking-[0.6px] text-ink-muted">
          Integrations
        </span>
        <p className="mb-2 text-meta text-ink-faint">
          A second gate: a toolset backed by an integration is usable only if that integration is
          granted here too. Built-in toolsets are unaffected.
        </p>
        <div className="flex flex-col gap-1.5 rounded-card border border-line-default bg-surface-card p-3">
          {integrations.length === 0 && (
            <span className="text-meta text-ink-faint">
              No integrations yet — add one in Settings → Integrations.
            </span>
          )}
          {integrations.map((integration) => (
            <label
              key={integration.name}
              className="flex cursor-pointer items-center gap-2.5 text-secondary"
            >
              <input
                type="checkbox"
                checked={integrationGrants.has(integration.name)}
                onChange={() => setIntegrationGrants((s) => toggle(s, integration.name))}
              />
              <span className="text-ink-body">{integration.label}</span>
              <span className="rounded-chip border border-line-strong bg-line-subtle px-1.5 py-0.5 text-label text-ink-muted">
                {integration.kind}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onSave(name.trim(), [...members], [...grants], [...integrationGrants])}
          className="rounded-control bg-accent-strong px-3 py-1.5 text-secondary font-medium text-ink-on-accent hover:opacity-90 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control px-3 py-1.5 text-secondary text-ink-muted hover:text-ink-body"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto rounded-control border border-line-strong px-3 py-1.5 text-secondary text-status-failed hover:bg-tint-attention"
        >
          Delete team
        </button>
      </div>
    </section>
  )
}
