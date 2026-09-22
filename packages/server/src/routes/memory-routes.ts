import { zValidator } from "@hono/zod-validator"
import { AgentMemoryKind } from "@staffroom/protocol"
import { Hono } from "hono"
import { z } from "zod"
import {
  getAgentMemoryStore,
  MemoryNotFoundError,
  MemoryVersionConflictError,
} from "../coordinator/memory.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Operator access to an agent's external archive. Agent turns use tools instead.
 *
 * Mounted at `/api/memory`, so the paths here are relative — that keeps the type
 * (`MemoryRoutes`) clean for the Hono RPC client. The handlers are chained (RPC
 * infers the client from the chain) and validated with `zValidator`. Every
 * handler reads its tenant from the caller, never the path.
 */
const agentParam = z.object({ agent: z.string() })
const entryParam = z.object({ agent: z.string(), id: z.string() })

// The accepted update body. No protocol input schema exists, so the fields the
// old handler validated by hand are replicated here; an invalid body still
// answers with `{ error: "invalid_memory" }` so the shape is preserved.
const memoryInput = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  kind: AgentMemoryKind,
  title: z.string(),
  body: z.string(),
  contexts: z.array(z.string()).optional(),
})

export const memoryRoutes = new Hono<SessionEnv>()
  .get("/for/:agent", zValidator("param", agentParam), (context) => {
    const { tenantId } = context.get("caller")
    return context.json({
      entries: getAgentMemoryStore().list(tenantId, context.req.valid("param").agent),
    })
  })
  .post(
    "/for/:agent",
    zValidator("param", agentParam),
    zValidator("json", memoryInput, (result, context) => {
      if (!result.success) return context.json({ error: "invalid_memory" }, 400)
    }),
    (context) => {
      const { tenantId } = context.get("caller")
      const { agent } = context.req.valid("param")
      const input = context.req.valid("json")
      try {
        const entry = getAgentMemoryStore().update(tenantId, agent, {
          id: input.id,
          key: input.key,
          expectedVersion: input.expectedVersion,
          kind: input.kind,
          title: input.title,
          body: input.body,
          contexts: input.contexts,
          source: "operator",
        })
        return context.json({ entry }, 201)
      } catch (error) {
        if (error instanceof MemoryVersionConflictError)
          return context.json({ error: "version_conflict" }, 409)
        if (error instanceof MemoryNotFoundError)
          return context.json({ error: "unknown_memory" }, 404)
        throw error
      }
    },
  )
  .get("/for/:agent/:id", zValidator("param", entryParam), (context) => {
    const { tenantId } = context.get("caller")
    const { agent, id } = context.req.valid("param")
    const entry = getAgentMemoryStore().get(tenantId, agent, id)
    return entry ? context.json({ entry }) : context.json({ error: "unknown_memory" }, 404)
  })
  .delete("/for/:agent/:id", zValidator("param", entryParam), (context) => {
    const { tenantId } = context.get("caller")
    const { agent, id } = context.req.valid("param")
    const removed = getAgentMemoryStore().forget(tenantId, agent, id)
    return removed
      ? context.json({ removed: true })
      : context.json({ error: "unknown_memory" }, 404)
  })

/** The router's type, for the Hono RPC client (`hc<MemoryRoutes>`). */
export type MemoryRoutes = typeof memoryRoutes
