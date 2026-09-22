import { defineTool, useSkill, useTool } from "@flue/runtime"
import { SkillInput, SkillUpdate } from "@staffroom/protocol"
import type { Skill } from "@staffroom/protocol"
import * as v from "valibot"
import { SkillExistsError, SkillsFullError, getSkillsStore } from "../coordinator/skills.ts"

/**
 * Mount an agent's skills and give it a tool to write more.
 *
 * Mounting reads the store at render — the agent's own enabled skills plus the
 * org directory, agent-shadows-org — and calls `useSkill()` per skill. Only
 * name and description enter the prompt; the instructions arrive as the
 * `activate_skill` tool result, so the per-render cost is one indexed read, not
 * tokens.
 *
 * Two guards mirror Flue's own posture. `allowedTools` is passed through only
 * for an admin-authored skill (an agent-set one would route around the
 * confirm-gates). And a row Flue would reject is skipped with a warning rather
 * than mounted — an invalid skill throws inside `useSkill()`, which fails every
 * turn for the agent, so one bad row must not brick the render.
 */
export interface SkillsToolContext {
  tenantId: string
  agent: string
}

export function attachSkills(context: SkillsToolContext): void {
  for (const skill of getSkillsStore().forRender(context.tenantId, context.agent)) {
    mountSkill(skill)
  }

  useTool(
    defineTool({
      name: "write_skill",
      description:
        "Write yourself a skill: a named, reusable procedure with a short description (when to use it) and full instructions (how). It is active immediately and appears in your skill list on the next turn. Use this to capture a way of doing something you will do again.",
      input: v.object({
        name: v.pipe(
          v.string(),
          v.minLength(1),
          v.maxLength(64),
          v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single hyphens"),
          v.description("A short kebab-case name"),
        ),
        description: v.pipe(v.string(), v.minLength(1), v.maxLength(1024)),
        instructions: v.pipe(v.string(), v.minLength(1)),
      }),
      run: async ({ data }) => {
        const parsed = SkillInput.safeParse(data)
        if (!parsed.success) return `That skill is not valid: ${parsed.error.issues[0]?.message}`
        try {
          getSkillsStore().writeAgentSkill(context.tenantId, context.agent, parsed.data, "agent")
          return `Wrote skill "${parsed.data.name}". It is active now and will be in your skill list next turn.`
        } catch (error) {
          if (error instanceof SkillExistsError) {
            return `You already have a skill named "${data.name}". Pick another name, or edit that one.`
          }
          if (error instanceof SkillsFullError) return `Cannot add it: ${error.message}`
          throw error
        }
      },
    }),
  )

  useTool(
    defineTool({
      name: "update_skill",
      description:
        "Update one of your own skills by name: revise its description or instructions, or disable/re-enable it. Only the fields you supply change. The change takes effect on the next turn. Use this to refine a skill you already wrote.",
      input: v.object({
        name: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("The kebab-case name of the skill to update"),
        ),
        description: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(1024))),
        instructions: v.optional(v.pipe(v.string(), v.minLength(1))),
        enabled: v.optional(v.boolean()),
      }),
      run: async ({ data }) => {
        const { name, ...rest } = data
        const patch = Object.fromEntries(
          Object.entries(rest).filter(([, value]) => value !== undefined),
        )
        if (Object.keys(patch).length === 0) {
          return "Nothing to update: supply a description, instructions, or enabled."
        }
        const parsed = SkillUpdate.safeParse(patch)
        if (!parsed.success) return `That update is not valid: ${parsed.error.issues[0]?.message}`
        try {
          const skill = getSkillsStore().update(context.tenantId, context.agent, name, parsed.data)
          if (!skill) return `You have no skill named "${name}".`
          return `Updated skill "${name}". The change takes effect next turn.`
        } catch (error) {
          if (error instanceof SkillsFullError) return `Cannot enable it: ${error.message}`
          throw error
        }
      },
    }),
  )

  useTool(
    defineTool({
      name: "remove_skill",
      description:
        "Delete one of your own skills by name. This is permanent — the skill disappears from your skill list next turn. To keep a skill but stop using it, disable it with update_skill instead.",
      input: v.object({
        name: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("The kebab-case name of the skill to remove"),
        ),
      }),
      run: async ({ data }) =>
        getSkillsStore().removeAgentSkill(context.tenantId, context.agent, data.name)
          ? `Removed skill "${data.name}". It will be gone from your skill list next turn.`
          : `You have no skill named "${data.name}".`,
    }),
  )
}

/** Mount one skill, honouring allowedTools only from an admin, skipping bad rows. */
function mountSkill(skill: Skill): void {
  try {
    useSkill({
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      // The one field an agent may not set (see §3): only an admin's survives.
      ...(skill.source === "admin" && skill.allowedTools
        ? { allowedTools: skill.allowedTools }
        : {}),
    })
  } catch (error) {
    // A malformed skill throws inside useSkill, which would fail this and every
    // future turn. Skip it loudly rather than brick the agent — the same stance
    // Flue takes for discovered skills.
    const detail = error instanceof Error ? error.message : String(error)
    console.warn(`[skills] skipping invalid skill "${skill.name}": ${detail}`)
  }
}
