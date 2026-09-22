import { useState } from "react"
import {
  type IntegrationRow,
  type TeamRow,
  type ToolsetInputBody,
  type ToolsetRow,
} from "../../../lib/api.ts"
import { ToolsetTeamSelect, teamsGranting, toggledSet } from "./team-select.tsx"

/** The register/edit form for a Docker Sandbox toolset — which integration it uses. */
export function SandboxToolsetForm({
  existing,
  integrations,
  teams,
  onCancel,
  onSave,
}: {
  existing?: ToolsetRow
  integrations: IntegrationRow[]
  teams: TeamRow[]
  onCancel: () => void
  onSave: (name: string, input: ToolsetInputBody, teamIds: string[]) => void
}) {
  const [name, setName] = useState(existing?.name ?? "")
  const [label, setLabel] = useState(existing?.label ?? "")
  const [integration, setIntegration] = useState(
    existing?.integration ?? integrations[0]?.name ?? "",
  )
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(
    new Set(teamsGranting(teams, existing && `sandbox:${existing.name}`)),
  )
  const toggleTeam = (id: string) => setSelectedTeams((prior) => toggledSet(prior, id))

  const inputClass =
    "w-full rounded-control border border-line-strong bg-surface-inset px-2.5 py-1.5 text-secondary text-ink-body"

  return (
    <div className="rounded-card border border-line-strong bg-surface-card px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Name
          <input
            className={inputClass}
            value={label}
            placeholder="Backend sandbox"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-meta text-ink-muted">
          Slug (grant key)
          <input
            className={inputClass}
            value={name}
            disabled={Boolean(existing)}
            placeholder="backend-sandbox"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-meta text-ink-muted">
          Docker Sandbox integration (its repos)
          <select
            className={inputClass}
            value={integration}
            onChange={(e) => setIntegration(e.target.value)}
          >
            {integrations.length === 0 && <option value="">No Docker Sandbox integrations</option>}
            {integrations.map((i) => (
              <option key={i.name} value={i.name}>
                {i.label} ({i.repos.length} repo{i.repos.length === 1 ? "" : "s"})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-meta text-ink-faint">
        Grants the built-in read/write/edit/bash/grep/glob tools over a container mounting that
        integration's repos.
      </p>

      <ToolsetTeamSelect teams={teams} selected={selectedTeams} onToggle={toggleTeam} />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!name.trim() || !label.trim() || !integration}
          onClick={() =>
            onSave(name, { label: label.trim() || name, kind: "sandbox", integration }, [
              ...selectedTeams,
            ])
          }
          className="rounded-control bg-accent-strong px-3 py-1.5 text-secondary font-medium text-ink-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {existing ? "Save changes" : "Add sandbox toolset"}
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
