import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createClient } from "../src/index.ts"

/**
 * The `files` domain against the real server routes, driven exactly as the CLI
 * drives it: a client whose `fetch` is wired straight to the app, carrying an
 * `x-api-key`. This is the whole upload → list → download → label → share →
 * remove path the CLI's `files` command is a thin shell over.
 *
 * In-process on purpose: a subprocess CLI plus an in-process server deadlock
 * (the sync child call blocks the loop the server runs on), so the surface is
 * verified here where it can be, and the CLI glue above it is just typed I/O.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-client-files-"))
process.env.STAFFROOM_HOME = home

// Reach into the server's source directly: its public exports are `.` (the
// fully-wired app, with Docker/scheduler side effects), `./lib` and `./routes`,
// none of which is the bare app factory a test wants. Tests already couple to
// source this way; this keeps the server's public surface from widening.
const { getAuth, runAuthMigrations } = await import("../../server/src/core/auth.ts")
const { createApp } = await import("../../server/src/create-app.ts")
const { getDatabase } = await import("../../server/src/coordinator/database.ts")
const { migrateToLatest } = await import("../../server/src/coordinator/migrations.ts")

describe("files domain over the real routes", () => {
  let client: ReturnType<typeof createClient>

  beforeAll(async () => {
    const app = createApp({ auth: getAuth(), agentRouter: new Hono(), uiDir: join(home, "ui") })
    await migrateToLatest(getDatabase())
    await runAuthMigrations(getAuth())

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "f@example.com",
        password: "correct-horse-battery",
        name: "F",
      }),
    })
    const cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
    const created = await app.request("/api/keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "cli" }),
    })
    const key = ((await created.json()) as { key: { key: string } }).key.key

    client = createClient({
      baseUrl: "http://localhost",
      headers: { "x-api-key": key },
      // Route every request straight into the app, no socket. hono/client always
      // passes a string URL, so forwarding to `app.request` is safe.
      fetch: ((input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
        app.request(String(input), init)) as typeof fetch,
    })
  })

  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it("uploads a file with labels and lists it back", async () => {
    const file = new File(["hello staffroom"], "hello.txt", { type: "text/plain" })
    const { file: uploaded } = await client.files.upload(file, { labels: ["greeting", "demo"] })
    expect(uploaded.name).toBe("hello.txt")
    expect(uploaded.size).toBe("hello staffroom".length)
    expect(uploaded.labels.sort()).toEqual(["demo", "greeting"])
    expect(uploaded.visibility).toBe("private")

    const listed = await client.files.list()
    expect(listed.map((f) => f.id)).toContain(uploaded.id)
  })

  it("downloads the exact bytes back", async () => {
    const { file } = await client.files.upload(new File(["round-trip"], "rt.txt"))
    expect(await client.files.text(file.id)).toBe("round-trip")
  })

  it("replaces labels, shares, and removes", async () => {
    const { file } = await client.files.upload(new File(["x"], "x.txt"), { labels: ["old"] })

    const relabelled = await client.files.setLabels(file.id, ["new"])
    expect(relabelled.file.labels).toEqual(["new"])

    const shared = await client.files.setVisibility(file.id, "org")
    expect(shared.file.visibility).toBe("org")

    await client.files.remove(file.id)
    expect((await client.files.list()).map((f) => f.id)).not.toContain(file.id)
  })

  it("pages, reporting a total and the labels across the set", async () => {
    await client.files.upload(new File(["a"], "page-a.txt"), { labels: ["paging"] })
    await client.files.upload(new File(["b"], "page-b.txt"), { labels: ["paging"] })

    const first = await client.files.page({ limit: 1, offset: 0, label: "paging", sort: "name" })
    expect(first.total).toBe(2)
    expect(first.files.map((f) => f.name)).toEqual(["page-a.txt"])
    expect(first.labels).toContain("paging")

    const second = await client.files.page({ limit: 1, offset: 1, label: "paging", sort: "name" })
    expect(second.files.map((f) => f.name)).toEqual(["page-b.txt"])
  })
})
