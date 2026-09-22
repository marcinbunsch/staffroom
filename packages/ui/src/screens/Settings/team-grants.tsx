import { type TeamRow } from "../../lib/api.ts"

/** Add or remove a value from a Set, returning a new Set (for React state). */
export function toggledSet<T>(prior: Set<T>, value: T): Set<T> {
  const next = new Set(prior)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** The ids of the teams whose grant list (via `grantsOf`) includes `key`. */
export function teamsGranting(
  teams: TeamRow[],
  key: string | undefined | false,
  grantsOf: (team: TeamRow) => string[] = (team) => team.grants,
): string[] {
  if (!key) return []
  return teams.filter((team) => grantsOf(team).includes(key)).map((team) => team.id)
}

/** A team multi-select for a config form — the selection is applied on save. */
export function TeamSelect({
  teams,
  selected,
  onToggle,
  label,
}: {
  teams: TeamRow[]
  selected: Set<string>
  onToggle: (teamId: string) => void
  label: string
}) {
  if (teams.length === 0) return null
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-meta text-ink-muted">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => onToggle(team.id)}
            className={`rounded-chip border px-2 py-0.5 text-label ${
              selected.has(team.id)
                ? "border-accent-strong bg-accent-strong text-ink-on-accent"
                : "border-line-strong text-ink-muted hover:bg-line-subtle"
            }`}
          >
            {team.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The teams that grant something, as toggle chips — grant/revoke in one click. */
export function TeamGrantChips({
  teams,
  granted,
  onToggle,
}: {
  teams: TeamRow[]
  granted: (team: TeamRow) => boolean
  onToggle: (team: TeamRow) => void
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line-subtle pt-2.5">
      <span className="text-meta text-ink-faint">Teams:</span>
      {teams.map((team) => (
        <button
          key={team.id}
          type="button"
          onClick={() => onToggle(team)}
          className={`rounded-chip border px-2 py-0.5 text-label ${
            granted(team)
              ? "border-accent-strong bg-accent-strong text-ink-on-accent"
              : "border-line-strong text-ink-muted hover:bg-line-subtle"
          }`}
        >
          {team.name}
        </button>
      ))}
    </div>
  )
}
