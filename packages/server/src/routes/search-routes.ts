import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"
import { getSearchIndex } from "../coordinator/search.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * Keyword search over the caller's readable content, for the UI's search box.
 *
 * Mounted at `/api/search`, so the path here is relative — that keeps the type
 * (`SearchRoutes`) clean for the Hono RPC client. The handler is chained (RPC
 * infers the client from the chain) and validated with `zValidator` (the input
 * types the client sees).
 */
export const searchRoutes = new Hono<SessionEnv>().get(
  "/",
  zValidator("query", z.object({ q: z.string().optional(), kind: z.string().optional() })),
  (context) => {
    const { tenantId } = context.get("caller")
    const { q, kind } = context.req.valid("query")
    const hits = getSearchIndex().search(tenantId, q ?? "", {
      kinds: kind === "file" ? ["file"] : undefined,
      limit: 25,
    })
    return context.json({ hits })
  },
)

/** The router's type, for the Hono RPC client (`hc<SearchRoutes>`). */
export type SearchRoutes = typeof searchRoutes
