import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The operator event stream, end to end over real HTTP with a real session: a
 * published event reaches a connected client, and only within its own tenant.
 * This is the push channel the UI's data layer replaced polling with, so if it
 * does not deliver, no badge ever moves.
 */

const home = mkdtempSync(join(tmpdir(), "staffroom-opstream-"))
process.env.STAFFROOM_HOME = home
// Signs up two accounts; keep sign-up open for the multi-tenant setup.
process.env.STAFFROOM_OPEN_SIGNUP = "1"

const { createAuth, runAuthMigrations } = await import("../src/core/auth.ts")
const { createApp } = await import("../src/create-app.ts")
const { getDatabase } = await import("../src/coordinator/database.ts")
const { migrateToLatest } = await import("../src/coordinator/migrations.ts")
const { getOperatorEvents } = await import("../src/coordinator/operator-events.ts")

function stubAgentRouter() {
  const router = new Hono()
  router.all("/:id", (context) => context.json({ admitted: context.req.param("id") }))
  return router
}

function buildApp() {
  const auth = createAuth({
    databasePath: join(home, "staffroom.db"),
    secret: "test-secret-not-a-real-one",
    baseURL: "http://127.0.0.1:3000",
  })
  return createApp({ auth, agentRouter: stubAgentRouter(), uiDir: join(home, "ui") })
}

type App = ReturnType<typeof buildApp>

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

/** Read SSE frames off a response body until `predicate` is satisfied or it times out. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (frame: string) => boolean,
  timeoutMs = 2000,
): Promise<string[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const frames: string[] = []
  let buffer = ""
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const next = await Promise.race([
        reader.read(),
        new Promise<{ timeout: true }>((resolve) =>
          setTimeout(() => resolve({ timeout: true }), deadline - Date.now()),
        ),
      ])
      if ("timeout" in next) break
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      const parts = buffer.split("\n\n")
      buffer = parts.pop() ?? ""
      for (const part of parts) {
        frames.push(part)
        if (predicate(part)) return frames
      }
    }
  } finally {
    await reader.cancel()
  }
  return frames
}

const dataOf = (frame: string): string | undefined =>
  frame
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
    .trim()

describe("the operator event stream", () => {
  let app: App
  let alice: string
  let bob: string
  let aliceTenant: string
  let bobTenant: string

  beforeAll(async () => {
    app = buildApp()
    await migrateToLatest(getDatabase())
    await runAuthMigrations(
      createAuth({
        databasePath: join(home, "staffroom.db"),
        secret: "test-secret-not-a-real-one",
        baseURL: "http://127.0.0.1:3000",
      }),
    )
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
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("401s an unauthenticated connection", async () => {
    const response = await app.request("/api/operator/stream")
    expect(response.status).toBe(401)
  })

  it("delivers a published event to the tenant it is for", async () => {
    const response = await app.request("/api/operator/stream", { headers: { cookie: alice } })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")

    // Publish a moment after the client is reading, then look for it on the wire.
    setTimeout(
      () =>
        getOperatorEvents().publish({
          tenantId: aliceTenant,
          event: { type: "attention.changed" },
        }),
      50,
    )
    const frames = await readUntil(
      response.body!,
      (frame) => dataOf(frame) === '{"type":"attention.changed"}',
    )
    const payloads = frames.map(dataOf).filter((data): data is string => data !== undefined)
    expect(payloads).toContain('{"type":"attention.changed"}')
  })

  it("does not leak another tenant's event", async () => {
    const response = await app.request("/api/operator/stream", { headers: { cookie: alice } })
    setTimeout(() => {
      getOperatorEvents().publish({ tenantId: bobTenant, event: { type: "attention.changed" } })
      // A broadcast (no tenant) that alice *should* see, as the terminator.
      getOperatorEvents().publish({ event: { type: "job.state.changed" } })
    }, 50)
    const frames = await readUntil(
      response.body!,
      (frame) => dataOf(frame) === '{"type":"job.state.changed"}',
    )
    const payloads = frames.map(dataOf).filter((data): data is string => data !== undefined)
    expect(payloads).toContain('{"type":"job.state.changed"}')
    expect(payloads).not.toContain('{"type":"attention.changed"}')
  })
})
