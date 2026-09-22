import { describe, expect, it } from "vitest"
import { TeamStore } from "../../src/coordinator/teams.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function store(): Promise<TeamStore> {
  return new TeamStore(await migratedDatabase())
}

describe("the team store", () => {
  it("creates, renames and removes a team", async () => {
    const teams = await store()
    const team = teams.create("Ops")
    expect(team.name).toBe("Ops")
    expect(teams.rename(team.id, "Platform")?.name).toBe("Platform")
    expect(teams.remove(team.id)).toBe(true)
    expect(teams.get(team.id)).toBeUndefined()
  })

  it("sets members and grants, replacing the whole list each time", async () => {
    const teams = await store()
    const team = teams.create("Ops")
    teams.setMembers(team.id, ["alice", "bob", "alice"]) // deduped
    expect(teams.members(team.id).sort()).toEqual(["alice", "bob"])
    teams.setMembers(team.id, ["alice"]) // replaces
    expect(teams.members(team.id)).toEqual(["alice"])

    teams.setGrants(team.id, ["firecrawl_scrape", "mcp:slack"])
    expect(teams.grants(team.id).sort()).toEqual(["firecrawl_scrape", "mcp:slack"])
    teams.setGrants(team.id, ["firecrawl_scrape"])
    expect(teams.grants(team.id)).toEqual(["firecrawl_scrape"])
  })

  it("a user on no team gets an empty grant set (restrictive default)", async () => {
    const teams = await store()
    expect(teams.grantedToolsets("alice").size).toBe(0)
  })

  it("grantedToolsets is the union across a user's teams", async () => {
    const teams = await store()
    const a = teams.create("A")
    const b = teams.create("B")
    teams.setMembers(a.id, ["alice"])
    teams.setMembers(b.id, ["alice"])
    teams.setGrants(a.id, ["firecrawl_scrape"])
    teams.setGrants(b.id, ["mcp:slack", "firecrawl_scrape"])

    const granted = teams.grantedToolsets("alice")
    expect([...granted].sort()).toEqual(["firecrawl_scrape", "mcp:slack"])
    // bob is on neither team.
    expect(teams.grantedToolsets("bob").size).toBe(0)
  })

  it("sets integration grants, replacing the whole list, unioned across teams", async () => {
    const teams = await store()
    const a = teams.create("A")
    const b = teams.create("B")
    teams.setMembers(a.id, ["alice"])
    teams.setMembers(b.id, ["alice"])
    teams.setIntegrationGrants(a.id, ["google", "google"]) // deduped
    teams.setIntegrationGrants(b.id, ["slack"])
    expect(teams.integrationGrants(a.id)).toEqual(["google"])
    expect([...teams.grantedIntegrations("alice")].sort()).toEqual(["google", "slack"])

    teams.setIntegrationGrants(a.id, []) // replaces
    expect(teams.integrationGrants(a.id)).toEqual([])
    expect([...teams.grantedIntegrations("alice")]).toEqual(["slack"])
    // bob is on neither team.
    expect(teams.grantedIntegrations("bob").size).toBe(0)
  })

  it("removing a team drops its members, grants and integration grants", async () => {
    const teams = await store()
    const team = teams.create("Ops")
    teams.setMembers(team.id, ["alice"])
    teams.setGrants(team.id, ["firecrawl_scrape"])
    teams.setIntegrationGrants(team.id, ["slack"])
    teams.remove(team.id)
    expect(teams.grantedToolsets("alice").size).toBe(0)
    expect(teams.grantedIntegrations("alice").size).toBe(0)
  })

  it("listDetail returns members, grants and integration grants per team", async () => {
    const teams = await store()
    const team = teams.create("Ops")
    teams.setMembers(team.id, ["alice"])
    teams.setGrants(team.id, ["mcp:slack"])
    teams.setIntegrationGrants(team.id, ["slack"])
    const detail = teams.listDetail()
    expect(detail).toHaveLength(1)
    expect(detail[0]).toMatchObject({
      name: "Ops",
      members: ["alice"],
      grants: ["mcp:slack"],
      integrationGrants: ["slack"],
    })
  })
})
