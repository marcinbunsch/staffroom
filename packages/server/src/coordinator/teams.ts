import { randomUUID } from "node:crypto"
import type { Team, TeamDetail } from "@staffroom/protocol"
import { type Database, getDatabase } from "./database.ts"

/**
 * Teams and their toolset grants — an authorization layer, org-wide.
 *
 * The one resolution the agent path needs is {@link grantedToolsets}: the union
 * of toolset keys across every team a user belongs to. A user on no team gets an
 * empty set (the restrictive default), so their agents are offered no
 * credential-backed toolset until they are placed on a team.
 */
export class TeamStore {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  list(): Team[] {
    return this.#db
      .all(this.#db.qb.selectFrom("teams").selectAll().orderBy("name", "asc"))
      .map(rowToTeam)
  }

  /** Every team with its members and granted toolsets — for the admin screen. */
  listDetail(): TeamDetail[] {
    return this.list().map((team) => ({
      ...team,
      members: this.members(team.id),
      grants: this.grants(team.id),
      integrationGrants: this.integrationGrants(team.id),
    }))
  }

  get(id: string): Team | undefined {
    const row = this.#db.get(this.#db.qb.selectFrom("teams").selectAll().where("id", "=", id))
    return row ? rowToTeam(row) : undefined
  }

  create(name: string): Team {
    const now = new Date().toISOString()
    const id = randomUUID()
    this.#db.run(
      this.#db.qb.insertInto("teams").values({ id, name, created_at: now, updated_at: now }),
    )
    return this.#require(id)
  }

  rename(id: string, name: string): Team | undefined {
    this.#db.run(
      this.#db.qb
        .updateTable("teams")
        .set({ name, updated_at: new Date().toISOString() })
        .where("id", "=", id),
    )
    return this.get(id)
  }

  remove(id: string): boolean {
    this.#db.run(this.#db.qb.deleteFrom("team_members").where("team_id", "=", id))
    this.#db.run(this.#db.qb.deleteFrom("team_grants").where("team_id", "=", id))
    this.#db.run(this.#db.qb.deleteFrom("team_integration_grants").where("team_id", "=", id))
    return this.#db.run(this.#db.qb.deleteFrom("teams").where("id", "=", id)).changes > 0
  }

  // ─── Members ──────────────────────────────────────────────────────────────

  members(teamId: string): string[] {
    return this.#db
      .all(this.#db.qb.selectFrom("team_members").select("user_id").where("team_id", "=", teamId))
      .map((row) => row.user_id)
  }

  /** Replace a team's whole membership with the given user ids. */
  setMembers(teamId: string, userIds: string[]): void {
    this.#db.transaction(() => {
      this.#db.run(this.#db.qb.deleteFrom("team_members").where("team_id", "=", teamId))
      const unique = [...new Set(userIds)]
      if (unique.length > 0) {
        this.#db.run(
          this.#db.qb
            .insertInto("team_members")
            .values(unique.map((user_id) => ({ team_id: teamId, user_id }))),
        )
      }
    })
  }

  // ─── Grants ───────────────────────────────────────────────────────────────

  grants(teamId: string): string[] {
    return this.#db
      .all(this.#db.qb.selectFrom("team_grants").select("toolset").where("team_id", "=", teamId))
      .map((row) => row.toolset)
  }

  /** Replace a team's whole grant list with the given toolset keys. */
  setGrants(teamId: string, toolsets: string[]): void {
    this.#db.transaction(() => {
      this.#db.run(this.#db.qb.deleteFrom("team_grants").where("team_id", "=", teamId))
      const unique = [...new Set(toolsets)]
      if (unique.length > 0) {
        this.#db.run(
          this.#db.qb
            .insertInto("team_grants")
            .values(unique.map((toolset) => ({ team_id: teamId, toolset }))),
        )
      }
    })
  }

  /**
   * The toolset keys a user may use — the union across all their teams. Empty
   * for a user on no team, which is the restrictive default the agent path
   * intersects an agent's own grants against.
   */
  grantedToolsets(userId: string): Set<string> {
    const rows = this.#db.all(
      this.#db.qb
        .selectFrom("team_grants")
        .innerJoin("team_members", "team_members.team_id", "team_grants.team_id")
        .select("team_grants.toolset")
        .where("team_members.user_id", "=", userId)
        .distinct(),
    )
    return new Set(rows.map((row) => row.toolset))
  }

  // ─── Integration grants ─────────────────────────────────────────────────────

  integrationGrants(teamId: string): string[] {
    return this.#db
      .all(
        this.#db.qb
          .selectFrom("team_integration_grants")
          .select("integration")
          .where("team_id", "=", teamId),
      )
      .map((row) => row.integration)
  }

  /** Replace a team's whole integration-grant list with the given names. */
  setIntegrationGrants(teamId: string, integrations: string[]): void {
    this.#db.transaction(() => {
      this.#db.run(this.#db.qb.deleteFrom("team_integration_grants").where("team_id", "=", teamId))
      const unique = [...new Set(integrations)]
      if (unique.length > 0) {
        this.#db.run(
          this.#db.qb
            .insertInto("team_integration_grants")
            .values(unique.map((integration) => ({ team_id: teamId, integration }))),
        )
      }
    })
  }

  /**
   * The integration names a user may use — the union across all their teams.
   * The second gate: a toolset backed by an integration attaches only if that
   * integration is in this set (built-in toolsets, tied to no integration, are
   * unaffected). Empty for a user on no team.
   */
  grantedIntegrations(userId: string): Set<string> {
    const rows = this.#db.all(
      this.#db.qb
        .selectFrom("team_integration_grants")
        .innerJoin("team_members", "team_members.team_id", "team_integration_grants.team_id")
        .select("team_integration_grants.integration")
        .where("team_members.user_id", "=", userId)
        .distinct(),
    )
    return new Set(rows.map((row) => row.integration))
  }

  #require(id: string): Team {
    const team = this.get(id)
    if (!team) throw new Error(`team "${id}" did not persist`)
    return team
  }
}

function rowToTeam(row: {
  id: string
  name: string
  created_at: string
  updated_at: string
}): Team {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

let store: TeamStore | undefined

export function getTeamStore(): TeamStore {
  if (!store) store = new TeamStore(getDatabase())
  return store
}
