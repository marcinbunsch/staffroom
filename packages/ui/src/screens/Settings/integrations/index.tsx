import { useCallback, useEffect, useState } from "react"
import {
  type IntegrationInputBody,
  type IntegrationRow,
  type IntegrationTypeRow,
  type Me,
  type TeamRow,
  api,
} from "../../../lib/api.ts"
import { BackLink, PickCard } from "../common.tsx"
import { TeamGrantChips } from "../team-grants.tsx"
import { IntegrationCard } from "./IntegrationCard.tsx"
import { IntegrationForm } from "./IntegrationForm.tsx"

// ── Integrations (admin app config that unlocks a tool family) ───────────────

type IntegrationView =
  | { kind: "list" }
  | { kind: "picker" }
  | { kind: "setup"; type: IntegrationTypeRow; existing?: IntegrationRow }

export function IntegrationsSection({ me }: { me: Me }) {
  const isAdmin = me.role === "admin"
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([])
  const [types, setTypes] = useState<IntegrationTypeRow[]>([])
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [error, setError] = useState<string>()
  const [view, setView] = useState<IntegrationView>({ kind: "list" })

  const reload = useCallback(() => {
    api.integrations.list().then(setIntegrations, () => setIntegrations([]))
    api.integrations.types().then(setTypes, () => setTypes([]))
    // A single-user server has no teams to grant through; leave them out.
    if (isAdmin && !me.singleUser) api.teams.list().then(setTeams, () => setTeams([]))
  }, [isAdmin, me.singleUser])
  useEffect(() => reload(), [reload])

  // Consent finishes in another tab (or another browser, via copy-link), so the
  // connection lands while this page is in the background. Refetch when the tab
  // regains focus, so coming back shows it connected without a manual reload.
  useEffect(() => {
    const onActive = () => {
      if (document.visibilityState === "visible") reload()
    }
    window.addEventListener("focus", onActive)
    document.addEventListener("visibilitychange", onActive)
    return () => {
      window.removeEventListener("focus", onActive)
      document.removeEventListener("visibilitychange", onActive)
    }
  }, [reload])

  // Coming back from a consent redirect (?integration=<name>&status=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get("status")
    if (!status) return
    if (status === "error") setError(`Connecting ${params.get("integration") ?? "the app"} failed.`)
    window.history.replaceState({}, "", window.location.pathname)
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

  const back = () => {
    setError(undefined)
    setView({ kind: "list" })
  }
  const typeOf = (name: string) => types.find((t) => t.type === name)

  // Grant or revoke an integration for a team, straight from the list card.
  function toggleTeamGrant(team: TeamRow, integrationName: string) {
    const next = team.integrationGrants.includes(integrationName)
      ? team.integrationGrants.filter((g) => g !== integrationName)
      : [...team.integrationGrants, integrationName]
    run(() => api.teams.setIntegrationGrants(team.id, next))
  }
  const teamChipsFor = (integrationName: string) =>
    isAdmin && teams.length > 0 ? (
      <TeamGrantChips
        teams={teams}
        granted={(team) => team.integrationGrants.includes(integrationName)}
        onToggle={(team) => toggleTeamGrant(team, integrationName)}
      />
    ) : null

  // Save an integration and, in one step, reconcile which teams grant it — so an
  // admin can configure and hand out access without leaving the config screen.
  async function saveIntegrationWithTeams(input: IntegrationInputBody, teamIds: string[]) {
    await (view.kind === "setup" && view.existing
      ? api.integrations.update(view.existing.name, input)
      : api.integrations.create(input))
    if (!isAdmin) return
    const want = new Set(teamIds)
    await Promise.all(
      teams
        .filter((team) => want.has(team.id) !== team.integrationGrants.includes(input.name))
        .map((team) => {
          const next = want.has(team.id)
            ? [...team.integrationGrants, input.name]
            : team.integrationGrants.filter((g) => g !== input.name)
          return api.teams.setIntegrationGrants(team.id, next)
        }),
    )
  }

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Integrations</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        An integration is an OAuth app people connect their own account to. Register several of a
        type — a read-only Slack app and a full one, say — and point different toolsets at each.{" "}
        {isAdmin ? "" : "Admin-managed."}
      </p>

      {error && <p className="mt-4 text-secondary text-status-failed">{error}</p>}

      {view.kind === "list" && (
        <>
          <div className="mt-6 flex items-center gap-2">
            <span className="text-meta text-ink-faint">
              {integrations.length} integration{integrations.length === 1 ? "" : "s"}
            </span>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setView({ kind: "picker" })}
                className="ml-auto rounded-control bg-accent-strong px-3 py-1.5 text-meta font-medium text-ink-on-accent hover:opacity-90"
              >
                <i className="ti ti-plus" /> Add integration
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {integrations.length === 0 && (
              <p className="rounded-card border border-line-default bg-surface-card px-4 py-6 text-center text-secondary text-ink-faint">
                No integrations yet.
              </p>
            )}
            {integrations.map((integration) => (
              <IntegrationCard
                key={integration.name}
                integration={integration}
                isAdmin={isAdmin}
                teamChips={teamChipsFor(integration.name)}
                onConfigure={() => {
                  const t = typeOf(integration.type)
                  if (t) setView({ kind: "setup", type: t, existing: integration })
                }}
                onRemove={() => run(() => api.integrations.remove(integration.name))}
                onDisconnect={() => run(() => api.integrations.disconnect(integration.name))}
              />
            ))}
          </div>
        </>
      )}

      {view.kind === "picker" && (
        <div className="mt-6">
          <BackLink onClick={back} label="Add an integration" />
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {types.map((type) => (
              <PickCard
                key={type.type}
                icon="ti-puzzle"
                title={type.label}
                description={type.description}
                onClick={() => setView({ kind: "setup", type })}
              />
            ))}
          </div>
        </div>
      )}

      {view.kind === "setup" && (
        <div className="mt-6">
          <BackLink onClick={back} label={`${view.type.label} setup`} />
          <div className="mt-4">
            <IntegrationForm
              type={view.type}
              existing={view.existing}
              teams={isAdmin ? teams : []}
              onCancel={back}
              onSave={(input, teamIds) =>
                run(() => saveIntegrationWithTeams(input, teamIds)).then((ok) => {
                  if (ok) back()
                })
              }
            />
          </div>
        </div>
      )}
    </section>
  )
}
