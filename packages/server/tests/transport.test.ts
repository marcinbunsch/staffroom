import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * M1's open transport question, answered by a test: does a **streaming** agent
 * request survive the pipeline — through `rejectForeignSession` and
 * `rejectUnknownAgent`, with a `:` in the path (the `tenant:agent` session key)
 * and only a session cookie for auth?
 *
 * The real agent router is `@flue/react`-driven and needs a model call plus the
 * Flue vite plugin, which the tests deliberately run without. So the router is
 * stubbed with one that *streams* (SSE), which is the part the question is
 * about: the middleware chain admits or refuses the colon-keyed path, and does
 * not break a streaming response on the way through. The Flue protocol itself is
 * proven in practice by the running app.
 */

const home = mkdtempSync(join(tmpdir(), "staffroom-transport-"))
process.env.STAFFROOM_HOME = home
// Signs up two accounts; keep sign-up open for the multi-tenant setup.
process.env.STAFFROOM_OPEN_SIGNUP = "1"

const { createAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { createApp } = await import("../src/create-app.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")

/** A stand-in agent router that streams, so the test exercises the streaming path. */
function streamingAgentRouter() {
  const router = new Hono()
  router.get("/:id", (context) =>
    streamSSE(context, async (stream) => {
      await stream.writeSSE({ data: `admitted ${context.req.param("id")}` })
      await stream.writeSSE({ data: "second-chunk" })
    }),
  )
  return router
}

function buildApp() {
  const auth = createAuth({
    databasePath: join(home, "staffroom.db"),
    secret: "test-secret-not-a-real-one",
    baseURL: "http://127.0.0.1:3000",
  })
  return {
    auth,
    app: createApp({ auth, agentRouter: streamingAgentRouter(), uiDir: join(home, "ui") }),
  }
}

type App = ReturnType<typeof buildApp>["app"]

async function signUp(app: App, email: string): Promise<string> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name: email }),
  })
  const cookie = response.headers.get("set-cookie")
  if (!cookie) throw new Error(`no session cookie for ${email}`)
  return cookie.split(";")[0] ?? ""
}

describe("the agent streaming transport", () => {
  let app: App
  let alice: string
  let bob: string
  let aliceTenant: string
  let bobTenant: string

  beforeAll(async () => {
    const built = buildApp()
    app = built.app
    await migrateToLatest(getDatabase())
    await runAuthMigrations(built.auth)

    alice = await signUp(app, "alice@example.com")
    bob = await signUp(app, "bob@example.com")
    aliceTenant = (
      (await (await app.request("/api/me", { headers: { cookie: alice } })).json()) as {
        tenantId: string
      }
    ).tenantId
    bobTenant = (
      (await (await app.request("/api/me", { headers: { cookie: bob } })).json()) as {
        tenantId: string
      }
    ).tenantId

    // Alice needs a real roster entry, so the unknown-agent guard admits it.
    const created = await app.request("/api/staff", {
      method: "POST",
      headers: { cookie: alice, "content-type": "application/json" },
      body: JSON.stringify({ id: "devops", name: "Alice ops", systemPrompt: "keep the lights on" }),
    })
    expect(created.status).toBe(201)
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("streams her own agent through the guards, colon path and cookie intact", async () => {
    const response = await app.request(`/agents/${aliceTenant}:devops`, {
      headers: { cookie: alice },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")

    // The body arrives as a stream that the guards passed through unbroken.
    const body = await drain(response.body)
    expect(body).toContain(`admitted ${aliceTenant}:devops`)
    expect(body).toContain("second-chunk")
  })

  it("refuses a foreign session key before any stream opens", async () => {
    const response = await app.request(`/agents/${bobTenant}:devops`, {
      headers: { cookie: alice },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get("content-type") ?? "").not.toContain("text/event-stream")
  })

  it("401s a streaming request with no session cookie", async () => {
    const response = await app.request(`/agents/${aliceTenant}:devops`)
    expect(response.status).toBe(401)
  })

  it("refuses an unparseable session key rather than guessing an owner", async () => {
    const response = await app.request("/agents/devops", { headers: { cookie: alice } })
    expect(response.status).toBe(400)
  })
})

async function drain(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return ""
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text
}
