import { getToolsetStore } from "../coordinator/toolsets.ts"

const GRANT_PREFIX = "mcp:"

/** A member-tool grant for a registered MCP server, or undefined for built-ins. */
export function mcpServerName(grant: string): string | undefined {
  if (!grant.startsWith(GRANT_PREFIX)) return undefined
  const name = grant.slice(GRANT_PREFIX.length)
  return name === "" || name.includes(":") ? undefined : name
}

/** The grant string for a server name. */
export function mcpGrant(name: string): string {
  return `${GRANT_PREFIX}${name}`
}

/** Whether a member-tool name is a currently registered MCP server grant. */
export function isMcpGrant(grant: string): boolean {
  const name = mcpServerName(grant)
  return name !== undefined && getToolsetStore().get(name) !== undefined
}

const SANDBOX_PREFIX = "sandbox:"

/** A grant for a sandbox toolset (`sandbox:<toolset-name>`), or undefined. */
export function sandboxToolsetName(grant: string): string | undefined {
  if (!grant.startsWith(SANDBOX_PREFIX)) return undefined
  const name = grant.slice(SANDBOX_PREFIX.length)
  return name === "" || name.includes(":") ? undefined : name
}

/** The grant string for a sandbox toolset. */
export function sandboxGrant(name: string): string {
  return `${SANDBOX_PREFIX}${name}`
}

/**
 * Parse a toolset grant `<kind>:<name>` into its parts, or undefined for a bare
 * catalog-tool grant (no colon). The kind is how the grant is written; the
 * toolset row is the authority on its actual kind, so callers dispatch on the
 * row, not this prefix. This generalizes the `mcp:` / `sandbox:` helpers above so
 * a plugin-contributed kind (`acme:foo`) is a grant like any other.
 */
export function grantToolset(grant: string): { kind: string; name: string } | undefined {
  const colon = grant.indexOf(":")
  if (colon <= 0) return undefined
  const name = grant.slice(colon + 1)
  if (name === "" || name.includes(":")) return undefined
  return { kind: grant.slice(0, colon), name }
}

/**
 * The integration a grant's toolset authenticates through, or undefined for a
 * built-in toolset (which is tied to no integration). Used for the team
 * integration gate: a grant whose integration a team lacks is not offered.
 */
export function grantIntegration(grant: string): string | undefined {
  const parsed = grantToolset(grant)
  if (parsed === undefined) return undefined
  // An empty integration means the toolset uses none (a plugin kind that
  // authenticates its own way) — so it is not subject to the team integration
  // gate. Coerce "" to undefined so the gate treats it as "no integration".
  return getToolsetStore().get(parsed.name)?.integration || undefined
}
