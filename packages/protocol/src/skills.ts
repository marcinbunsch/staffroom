import { z } from "zod"
import { AgentId, TenantId } from "./identity.ts"

/**
 * Agent skills — persistent, progressively-disclosed instructions.
 *
 * Flue implements the Agent Skills spec, but its *discovery* reads
 * `.agents/skills/` through a session's sandbox, so it only works for agents
 * that have one. Skills here are rows instead, mounted with `useSkill()` at
 * render time as inline definitions — which works for every agent, is covered
 * by the same tenant seam as everything else, and keeps durable agent state in
 * one place.
 *
 * The validation below **mirrors Flue's own** (`normalizeSkillDefinition`): a
 * row that Flue would reject at mount throws inside `useSkill()`, which fails
 * *every* turn for that agent, not just one that uses the skill. So the store
 * rejects the write, and the mount skips a bad row rather than letting it brick
 * the render.
 */
export const SkillScope = z.enum(["agent", "org"])

/** Who authored a skill — decides whether `allowedTools` is honoured. */
export const SkillSource = z.enum(["agent", "operator", "admin"])

export const SkillName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "a skill name is lowercase letters, digits and single hyphens",
  )

export const Skill = z.object({
  id: z.string(),
  scope: SkillScope,
  /** An agent-scoped skill carries both; an org skill carries neither. */
  tenantId: TenantId.nullable(),
  agent: AgentId.nullable(),
  name: SkillName,
  /** The always-present catalog line: what it does and when to use it. */
  description: z.string().min(1).max(1024),
  /** The SKILL.md body, loaded only on activation. */
  instructions: z.string().min(1),
  /**
   * Space-separated pre-approved tools. Honoured only when `source` is admin —
   * the spec calls it "pre-approved", and an agent-set one would route straight
   * around the confirm-gates.
   */
  allowedTools: z.string().nullable(),
  source: SkillSource,
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const SkillInput = z.object({
  name: SkillName,
  description: z.string().min(1).max(1024),
  instructions: z.string().min(1),
})

export const SkillUpdate = z
  .object({
    description: z.string().min(1).max(1024),
    instructions: z.string().min(1),
    enabled: z.boolean(),
  })
  .partial()

export type SkillScope = z.infer<typeof SkillScope>
export type SkillSource = z.infer<typeof SkillSource>
export type Skill = z.infer<typeof Skill>
export type SkillInput = z.infer<typeof SkillInput>
export type SkillUpdate = z.infer<typeof SkillUpdate>

/** The most enabled skills an agent may mount. Every one costs a catalog line. */
export const MAX_ENABLED_SKILLS = 24
