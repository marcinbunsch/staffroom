import { zValidator } from "@hono/zod-validator"
import { SkillInput, SkillUpdate } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import { SkillExistsError, SkillsFullError, getSkillsStore } from "../coordinator/skills.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Skills over HTTP. An operator manages an agent's own skills (create, edit,
 * enable/disable, delete); an admin curates the org directory, and is the only
 * one who may set allowedTools. A skill is active immediately and visible —
 * that visibility is what makes persistent instruction safe.
 *
 * Mounted at `/api/skills`, so the paths here are relative — that keeps the type
 * (`SkillRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator`.
 */
const agentParam = z.object({ agent: z.string() })
const agentNameParam = z.object({ agent: z.string(), name: z.string() })

/**
 * The org create body: `SkillInput` plus an optional `allowedTools`, which only
 * an admin may set. Extending the schema keeps the field in the RPC input type.
 */
const OrgSkillInput = SkillInput.extend({ allowedTools: z.string().nullable().optional() })

export const skillRoutes = new Hono<SessionEnv>()
  // The org directory. Admin only — allowedTools makes an org skill powerful.
  .get("/org", (context) => context.json({ skills: getSkillsStore().listOrg() }))
  .post("/org", zValidator("json", OrgSkillInput), (context) => {
    if (context.get("caller").role !== "admin")
      return context.json({ error: "admin_required" }, 403)
    const { allowedTools: rawAllowedTools, ...input } = context.req.valid("json")
    const allowedTools = typeof rawAllowedTools === "string" ? rawAllowedTools : null
    try {
      const skill = getSkillsStore().writeOrgSkill({ ...input, allowedTools })
      return context.json({ skill }, 201)
    } catch (error) {
      if (error instanceof SkillExistsError) return context.json({ error: "skill_exists" }, 409)
      throw error
    }
  })
  .get("/for/:agent", zValidator("param", agentParam), (context) => {
    const { tenantId } = context.get("caller")
    return context.json({
      skills: getSkillsStore().listForAgent(tenantId, context.req.valid("param").agent),
    })
  })
  .post(
    "/for/:agent",
    zValidator("param", agentParam),
    zValidator("json", SkillInput),
    (context) => {
      const { tenantId } = context.get("caller")
      const { agent } = context.req.valid("param")
      try {
        const skill = getSkillsStore().writeAgentSkill(
          tenantId,
          agent,
          context.req.valid("json"),
          "operator",
        )
        return context.json({ skill }, 201)
      } catch (error) {
        if (error instanceof SkillExistsError) return context.json({ error: "skill_exists" }, 409)
        if (error instanceof SkillsFullError) return context.json({ error: "skills_full" }, 409)
        throw error
      }
    },
  )
  .patch(
    "/for/:agent/:name",
    zValidator("param", agentNameParam),
    zValidator("json", SkillUpdate),
    (context) => {
      const { tenantId } = context.get("caller")
      const { agent, name } = context.req.valid("param")
      try {
        const skill = getSkillsStore().update(tenantId, agent, name, context.req.valid("json"))
        if (!skill) return context.json({ error: "unknown_skill" }, 404)
        return context.json({ skill })
      } catch (error) {
        if (error instanceof SkillsFullError) return context.json({ error: "skills_full" }, 409)
        throw error
      }
    },
  )
  .delete("/for/:agent/:name", zValidator("param", agentNameParam), (context) => {
    const { tenantId } = context.get("caller")
    const { agent, name } = context.req.valid("param")
    if (!getSkillsStore().removeAgentSkill(tenantId, agent, name)) {
      return context.json({ error: "unknown_skill" }, 404)
    }
    return context.json({ removed: true })
  })

/** The router's type, for the Hono RPC client (`hc<SkillRoutes>`). */
export type SkillRoutes = typeof skillRoutes
