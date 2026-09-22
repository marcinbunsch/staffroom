import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import {
  type Caller,
  type SessionEnv,
  rejectForeignSession,
  rejectUnknownAgent,
  requireSession,
} from "../../src/middleware/session.ts"

const ALICE: Caller = { tenantId: "alice", role: "user" }

/**
 * The pipeline as `app.ts` mounts it, with a stub session resolver: sign-in is
 * better-auth's problem and is proved in auth.test.ts. What is proved here is
 * the ordering and the refusals.
 */
// `null` means "signed out". Not `undefined`, which a default parameter would
// quietly turn back into Alice — as the first run of this file demonstrated.
function makeApp(caller: Caller | null = ALICE, roster: readonly string[] = ["devops"]) {
  const app = new Hono<SessionEnv>()
  app.use(
    "/agents/:id",
    requireSession(async () => caller ?? undefined),
  )
  app.use("/agents/:id", rejectForeignSession())
  app.use(
    "/agents/:id",
    rejectUnknownAgent((tenantId, agentId) => tenantId === "alice" && roster.includes(agentId)),
  )
  app.all("/agents/:id", (context) => context.json({ admitted: context.req.param("id") }))
  return app
}

describe("the session guard", () => {
  it("admits a caller addressing their own agent", async () => {
    const response = await makeApp().request("/agents/alice:devops")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ admitted: "alice:devops" })
  })

  it("admits a caller addressing their own job session", async () => {
    const response = await makeApp().request("/agents/alice:devops__job-42")
    expect(response.status).toBe(200)
  })

  it("401s without a session", async () => {
    const response = await makeApp(null).request("/agents/alice:devops")
    expect(response.status).toBe(401)
  })

  /**
   * The one that matters. Alice is authenticated; she is simply naming Bob's
   * session key in the URL. Without this the request would be admitted and
   * every layer downstream would read the tenant back out of that key and
   * agree with her.
   */
  it("403s a caller naming another tenant's session", async () => {
    const response = await makeApp().request("/agents/bob:devops")
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "forbidden" })
  })

  it("403s a caller naming another tenant's job session", async () => {
    const response = await makeApp().request("/agents/bob:devops__job-42")
    expect(response.status).toBe(403)
  })

  // "No owner" must never read as "mine": a key we cannot parse is refused
  // before the comparison, not defaulted into one side of it.
  it("400s an unparseable session key rather than guessing", async () => {
    for (const key of ["devops", ":devops", "alice:Dev_Ops", "alice:devops__job-x"]) {
      const response = await makeApp().request(`/agents/${key}`)
      expect(response.status, key).toBe(400)
    }
  })

  it("404s an agent the caller does not have", async () => {
    const response = await makeApp().request("/agents/alice:ghost")
    expect(response.status).toBe(404)
  })

  // Ordering: a foreign session key must be refused before the roster is
  // consulted, or the 404 would leak whether that tenant has that agent.
  it("prefers 403 over 404 for another tenant's unknown agent", async () => {
    const response = await makeApp().request("/agents/bob:ghost")
    expect(response.status).toBe(403)
  })
})
