import { useCallback, useEffect, useState } from "react"
import {
  type IntegrationRow,
  type Me,
  type TeamRow,
  type ToolCatalogRow,
  type ToolCredentialRow,
  type ToolsetInputBody,
  type ToolsetKindRow,
  type ToolsetRow,
  api,
} from "../../../lib/api.ts"
import { BackLink } from "../common.tsx"
import { McpToolsetForm } from "./McpToolsetForm.tsx"
import { PluginToolsetForm } from "./PluginToolsetForm.tsx"
import { SandboxToolsetForm } from "./SandboxToolsetForm.tsx"
import { ToolCard } from "./ToolCard.tsx"
import { ToolsetList } from "./ToolsetList.tsx"
import { ToolsetPicker } from "./ToolsetPicker.tsx"
import { ToolsetTeamChips } from "./team-select.tsx"

type ToolsetView =
  | { kind: "list" }
  | { kind: "picker" }
  | { kind: "builtin"; tool: ToolCatalogRow }
  | { kind: "mcp"; existing?: ToolsetRow }
  | { kind: "sandbox"; existing?: ToolsetRow }
  | { kind: "plugin"; kindInfo: ToolsetKindRow; existing?: ToolsetRow }

/**
 * Toolsets — one list of configured toolsets, and an "Add toolset" flow that
 * first picks a type (a built-in like Firecrawl, or MCP) and then opens that
 * type's setup. A built-in toolset is its credential config; an MCP toolset is
 * a server plus the tools chosen from it. Grants are per-toolset (Edit-agent,
 * and later teams).
 */
export function ToolsSection({ me }: { me: Me }) {
  const isAdmin = me.role === "admin"
  const [tools, setTools] = useState<ToolCatalogRow[]>([])
  const [creds, setCreds] = useState<ToolCredentialRow[]>([])
  const [servers, setServers] = useState<ToolsetRow[]>([])
  const [kinds, setKinds] = useState<ToolsetKindRow[]>([])
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([])
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [error, setError] = useState<string>()
  const [view, setView] = useState<ToolsetView>({ kind: "list" })

  const reload = useCallback(() => {
    api.tools.catalog().then(setTools, () => {})
    api.tools.credentials().then(setCreds, () => setCreds([]))
    api.toolsets.list().then(setServers, () => setServers([]))
    api.toolsets.kinds().then(setKinds, () => setKinds([]))
    api.integrations.list().then(setIntegrations, () => setIntegrations([]))
    // A single-user server has no teams to grant through; leave them out.
    if (isAdmin && !me.singleUser) api.teams.list().then(setTeams, () => setTeams([]))
  }, [isAdmin, me.singleUser])
  useEffect(() => reload(), [reload])

  const orgCredFor = (tool: string) => creds.find((c) => c.tool === tool && c.scope === "org")

  // Grant or revoke a toolset for a team, straight from the Toolsets list.
  function toggleTeamGrant(team: TeamRow, toolsetKey: string) {
    const next = team.grants.includes(toolsetKey)
      ? team.grants.filter((g) => g !== toolsetKey)
      : [...team.grants, toolsetKey]
    run(() => api.teams.setGrants(team.id, next))
  }
  const teamChipsFor = (toolsetKey: string) =>
    isAdmin && teams.length > 0 ? (
      <ToolsetTeamChips
        toolsetKey={toolsetKey}
        teams={teams}
        onToggle={(team) => toggleTeamGrant(team, toolsetKey)}
      />
    ) : null

  // Save a toolset and, in the same step, reconcile which teams grant it — so an
  // admin can configure and hand out a toolset without leaving the config screen.
  async function saveToolsetWithTeams(
    name: string,
    input: ToolsetInputBody,
    teamIds: string[],
  ): Promise<void> {
    await api.toolsets.put(name, input)
    if (!isAdmin) return
    const key = `${input.kind}:${name}`
    const want = new Set(teamIds)
    await Promise.all(
      teams
        .filter((team) => want.has(team.id) !== team.grants.includes(key))
        .map((team) => {
          const next = want.has(team.id)
            ? [...team.grants, key]
            : team.grants.filter((g) => g !== key)
          return api.teams.setGrants(team.id, next)
        }),
    )
  }

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

  const back = () => {
    setError(undefined)
    setView({ kind: "list" })
  }

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Toolsets</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        A toolset is a named set of tools — a built-in like Firecrawl, or the tools you pick from an
        MCP server. Grant toolsets to agents (and, later, teams); a toolset still has to be added to
        an agent to be used.
      </p>

      {error && <p className="mt-4 text-secondary text-status-failed">{error}</p>}

      {view.kind === "list" && (
        <ToolsetList
          isAdmin={isAdmin}
          builtins={tools}
          orgCredFor={orgCredFor}
          servers={servers}
          kinds={kinds}
          onAdd={() => setView({ kind: "picker" })}
          onEditBuiltin={(tool) => setView({ kind: "builtin", tool })}
          onEditMcp={(existing) => setView({ kind: "mcp", existing })}
          onEditSandbox={(existing) => setView({ kind: "sandbox", existing })}
          onEditKind={(kindInfo, existing) => setView({ kind: "plugin", kindInfo, existing })}
          onRemoveBuiltin={(id) => run(() => api.tools.removeCredential(id))}
          onRemoveToolset={(name) => run(() => api.toolsets.remove(name))}
          teamChipsFor={teamChipsFor}
        />
      )}

      {view.kind === "picker" && (
        <ToolsetPicker
          builtins={tools}
          pluginKinds={kinds.filter((k) => !k.builtinForm)}
          hasDockerSandbox={integrations.some((i) => i.kind === "docker")}
          onBack={back}
          onPickBuiltin={(tool) => setView({ kind: "builtin", tool })}
          onPickMcp={() => setView({ kind: "mcp" })}
          onPickSandbox={() => setView({ kind: "sandbox" })}
          onPickKind={(kindInfo) => setView({ kind: "plugin", kindInfo })}
        />
      )}

      {view.kind === "builtin" && (
        <div className="mt-6">
          <BackLink onClick={back} label={`${view.tool.label} setup`} />
          <div className="mt-4">
            <ToolCard
              tool={view.tool}
              isAdmin={isAdmin}
              orgCred={orgCredFor(view.tool.name)}
              onConnect={(secret) =>
                run(() =>
                  api.tools.putCredential({ scope: "org", tool: view.tool.name, secret }),
                ).then((ok) => {
                  if (ok) back()
                })
              }
              onDisconnect={(id) =>
                run(() => api.tools.removeCredential(id)).then((ok) => {
                  if (ok) back()
                })
              }
            />
          </div>
        </div>
      )}

      {view.kind === "mcp" && (
        <div className="mt-6">
          <BackLink onClick={back} label={view.existing ? "Edit MCP toolset" : "New MCP toolset"} />
          <div className="mt-4">
            <McpToolsetForm
              existing={view.existing}
              integrations={integrations}
              teams={isAdmin ? teams : []}
              onCancel={back}
              onSave={(name, input, teamIds) =>
                run(() => saveToolsetWithTeams(name, input, teamIds)).then((ok) => ok && back())
              }
              onError={setError}
            />
          </div>
        </div>
      )}

      {view.kind === "sandbox" && (
        <div className="mt-6">
          <BackLink
            onClick={back}
            label={view.existing ? "Edit sandbox toolset" : "New Docker Sandbox toolset"}
          />
          <div className="mt-4">
            <SandboxToolsetForm
              existing={view.existing}
              integrations={integrations.filter((i) => i.kind === "docker")}
              teams={isAdmin ? teams : []}
              onCancel={back}
              onSave={(name, input, teamIds) =>
                run(() => saveToolsetWithTeams(name, input, teamIds)).then((ok) => ok && back())
              }
            />
          </div>
        </div>
      )}

      {view.kind === "plugin" && (
        <div className="mt-6">
          <BackLink
            onClick={back}
            label={
              view.existing
                ? `Edit ${view.kindInfo.label} toolset`
                : `New ${view.kindInfo.label} toolset`
            }
          />
          <div className="mt-4">
            <PluginToolsetForm
              kindInfo={view.kindInfo}
              existing={view.existing}
              integrations={integrations}
              teams={isAdmin ? teams : []}
              onCancel={back}
              onSave={(name, input, teamIds) =>
                run(() => saveToolsetWithTeams(name, input, teamIds)).then((ok) => ok && back())
              }
              onError={setError}
            />
          </div>
        </div>
      )}
    </section>
  )
}
