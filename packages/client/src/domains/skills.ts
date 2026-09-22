import type { SkillRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"
import type { NewSkill, SkillRow } from "../types.ts"

/**
 * Skills — an agent's own, plus the org directory. On the typed Hono RPC client;
 * the methods hide the hc envelope (param/json, res.ok narrowing) behind plain
 * calls.
 */
export function skillsDomain(ctx: DomainContext) {
  const rpc = hc<SkillRoutes>(`${ctx.base}/api/skills`, ctx.hcInit)
  return {
    list: async (agent: string) => {
      const res = await rpc.for[":agent"].$get({ param: { agent } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).skills
    },
    create: async (agent: string, input: NewSkill) => {
      const res = await rpc.for[":agent"].$post({ param: { agent }, json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    update: async (
      agent: string,
      name: string,
      patch: Partial<Pick<SkillRow, "description" | "instructions" | "enabled">>,
    ) => {
      const res = await rpc.for[":agent"][":name"].$patch({ param: { agent, name }, json: patch })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
    remove: async (agent: string, name: string) => {
      const res = await rpc.for[":agent"][":name"].$delete({ param: { agent, name } })
      if (!res.ok) throw await apiError(res)
    },
    org: async () => {
      const res = await rpc.org.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).skills
    },
    createOrg: async (input: NewSkill & { allowedTools?: string | null }) => {
      const res = await rpc.org.$post({ json: input })
      if (!res.ok) throw await apiError(res)
      return await res.json()
    },
  }
}
