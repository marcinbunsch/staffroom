import { type TeamRow } from "../../../lib/api.ts"
import { TeamGrantChips, TeamSelect, teamsGranting, toggledSet } from "../team-grants.tsx"

export { toggledSet, teamsGranting }

/** A team multi-select for a toolset config form — applied when the form saves. */
export function ToolsetTeamSelect(props: {
  teams: TeamRow[]
  selected: Set<string>
  onToggle: (teamId: string) => void
}) {
  return <TeamSelect {...props} label="Teams that may use this toolset" />
}

/** The teams that grant a toolset, as toggle chips — grant/revoke in one click. */
export function ToolsetTeamChips({
  toolsetKey,
  teams,
  onToggle,
}: {
  toolsetKey: string
  teams: TeamRow[]
  onToggle: (team: TeamRow) => void
}) {
  return (
    <TeamGrantChips
      teams={teams}
      granted={(team) => team.grants.includes(toolsetKey)}
      onToggle={onToggle}
    />
  )
}
