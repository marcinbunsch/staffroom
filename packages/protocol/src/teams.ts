import { z } from "zod"

/**
 * Teams — an authorization layer over toolsets, not a data-isolation boundary.
 *
 * A team grants a set of toolsets; a user is a member of any number of teams;
 * their agents may use the **union** of their teams' granted toolsets (and no
 * credential-backed toolset when they are on no team — the restrictive default).
 * Built-in tools (jobs, files, memory, …) are always available and never gated.
 *
 * Teams are org-wide config an admin manages: no tenant column, members are
 * better-auth user ids, grants are toolset keys (`firecrawl_scrape`, `mcp:<slug>`).
 */

export const Team = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Team = z.infer<typeof Team>

/** A team with its members (user ids), granted toolset keys, and integrations. */
export const TeamDetail = Team.extend({
  members: z.array(z.string()),
  grants: z.array(z.string()),
  integrationGrants: z.array(z.string()),
})
export type TeamDetail = z.infer<typeof TeamDetail>

export const TeamInput = z.object({
  name: z.string().min(1).max(80),
})
export type TeamInput = z.infer<typeof TeamInput>

export const TeamMembersInput = z.object({
  userIds: z.array(z.string()),
})
export type TeamMembersInput = z.infer<typeof TeamMembersInput>

export const TeamGrantsInput = z.object({
  toolsets: z.array(z.string()),
})
export type TeamGrantsInput = z.infer<typeof TeamGrantsInput>

export const TeamIntegrationGrantsInput = z.object({
  integrations: z.array(z.string()),
})
export type TeamIntegrationGrantsInput = z.infer<typeof TeamIntegrationGrantsInput>
