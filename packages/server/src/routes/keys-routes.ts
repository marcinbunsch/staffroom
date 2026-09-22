import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { getAuth } from "../core/auth.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Personal API keys, mounted at `/api/keys`. Thin wrappers over the better-auth
 * apiKey plugin's server API, keyed to the calling session (the cookie in the
 * request headers), so a user manages only their own keys. The plaintext key is
 * returned once, on create; list never includes it.
 */
export const keysRoutes = new Hono<SessionEnv>()
  .get("/", async (context) => {
    const result = await getAuth().api.listApiKeys({ headers: context.req.raw.headers })
    return context.json({ keys: result.apiKeys })
  })
  .post("/", zValidator("json", z.object({ name: z.string().min(1) })), async (context) => {
    const key = await getAuth().api.createApiKey({
      body: { name: context.req.valid("json").name },
      headers: context.req.raw.headers,
    })
    return context.json({ key }, 201)
  })
  .delete("/:id", zValidator("param", z.object({ id: z.string() })), async (context) => {
    await getAuth().api.deleteApiKey({
      body: { keyId: context.req.valid("param").id },
      headers: context.req.raw.headers,
    })
    return context.json({ removed: true })
  })

export type KeyRoutes = typeof keysRoutes
