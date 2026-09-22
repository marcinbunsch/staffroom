import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isArtifact, type EventEnvelopeInput, type FileInput } from "@staffroom/protocol"
import { afterEach, describe, expect, it } from "vitest"
import { FilesStore } from "../../src/coordinator/files.ts"
import { SearchIndex } from "../../src/coordinator/search.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

let dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "staffroom-files-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function makeStore(published?: EventEnvelopeInput[]): Promise<FilesStore> {
  const db = await migratedDatabase()
  return new FilesStore(db, {
    dir: tempDir(),
    publish: published ? (input) => published.push(input) : undefined,
    search: new SearchIndex(db),
  })
}

function meta(overrides: Partial<FileInput> = {}): FileInput {
  return { name: "report.txt", contentType: "text/plain", source: "agent", ...overrides }
}

// Private files are scoped like any other row. Org files are shared on purpose
// (covered separately), so the contract seeds private files.
defineTenantIsolationTests("files (private)", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, name) => store.create(tenantId, meta({ name }), "body").id,
    read: (tenantId, id) => store.get(tenantId, id),
    list: (tenantId) => store.list(tenantId),
    remove: (tenantId, id) => store.remove(tenantId, id),
  }
})

describe("files", () => {
  it("stores bytes on disk and metadata in the row", async () => {
    const store = await makeStore()
    const file = store.create("alice", meta({ name: "notes.md" }), "hello world")

    expect(file).toMatchObject({
      name: "notes.md",
      size: 11,
      source: "agent",
      visibility: "private",
    })
    expect((await store.bytes("alice", file.id))?.toString("utf8")).toBe("hello world")
  })

  it("starts every file private, whatever the source", async () => {
    const store = await makeStore()
    const file = store.create("alice", meta({ source: "operator" }), "x")
    expect(file.visibility).toBe("private")
  })

  it("recognizes agent-produced files as artifacts", async () => {
    const store = await makeStore()
    const artifact = store.create("alice", meta({ agent: "devops" }), "finished report")
    const upload = store.create("alice", meta({ source: "operator" }), "source material")

    expect(isArtifact(artifact)).toBe(true)
    expect(isArtifact(upload)).toBe(false)
  })

  describe("sharing", () => {
    it("shows an org file to every tenant, but only the owner in listings scoped to them", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta(), "x")
      store.setVisibility("alice", file.id, "org")

      expect(store.get("bob", file.id)?.name).toBe("report.txt")
      expect(store.list("bob").map((f) => f.id)).toContain(file.id)
    })

    it("is a flip: un-sharing returns it to private", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta(), "x")
      store.setVisibility("alice", file.id, "org")
      store.setVisibility("alice", file.id, "private")

      expect(store.get("bob", file.id)).toBeUndefined()
    })

    it("only the owner may change sharing, not an org reader", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta(), "x")
      store.setVisibility("alice", file.id, "org")
      // Bob can see it, but cannot un-share (or re-share) it.
      expect(store.setVisibility("bob", file.id, "private")).toBeUndefined()
      expect(store.get("bob", file.id)?.visibility).toBe("org")
    })

    it("only the owner may delete, not an org reader", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta(), "x")
      store.setVisibility("alice", file.id, "org")
      expect(store.remove("bob", file.id)).toBe(false)
      expect(store.remove("alice", file.id)).toBe(true)
    })
  })

  describe("page", () => {
    it("returns one page plus the total across the whole matching set", async () => {
      const store = await makeStore()
      for (let i = 0; i < 5; i++) store.create("alice", meta({ name: `f${i}.txt` }), "x")

      const first = store.page("alice", { limit: 2, offset: 0, sort: "name" })
      expect(first.total).toBe(5)
      expect(first.files.map((f) => f.name)).toEqual(["f0.txt", "f1.txt"])

      const third = store.page("alice", { limit: 2, offset: 4, sort: "name" })
      expect(third.files.map((f) => f.name)).toEqual(["f4.txt"])
    })

    it("sorts by name case-insensitively", async () => {
      const store = await makeStore()
      store.create("alice", meta({ name: "banana.txt" }), "x")
      store.create("alice", meta({ name: "Apple.txt" }), "x")

      const byName = store.page("alice", { limit: 10, offset: 0, sort: "name" })
      expect(byName.files.map((f) => f.name)).toEqual(["Apple.txt", "banana.txt"])
    })

    it("filters by source, agent, visibility, and label — and totals reflect the filter", async () => {
      const store = await makeStore()
      store.create("alice", meta({ name: "up.txt", source: "operator" }), "x")
      store.create("alice", meta({ name: "art.txt", agent: "devops", labels: ["invoices"] }), "x")
      store.create("alice", meta({ name: "other.txt", agent: "pm" }), "x")

      expect(store.page("alice", { limit: 10, offset: 0, filter: "operator" }).total).toBe(1)
      expect(store.page("alice", { limit: 10, offset: 0, filter: "artifacts" }).total).toBe(2)
      expect(
        store.page("alice", { limit: 10, offset: 0, agent: "devops" }).files.map((f) => f.name),
      ).toEqual(["art.txt"])
      expect(
        store.page("alice", { limit: 10, offset: 0, label: "invoices" }).files.map((f) => f.name),
      ).toEqual(["art.txt"])
    })

    it("matches a label exactly — not a prefix of a longer one", async () => {
      const store = await makeStore()
      store.create("alice", meta({ name: "a.txt", labels: ["tax"] }), "x")
      store.create("alice", meta({ name: "b.txt", labels: ["taxes"] }), "x")

      expect(
        store.page("alice", { limit: 10, offset: 0, label: "tax" }).files.map((f) => f.name),
      ).toEqual(["a.txt"])
    })

    it("only shows org files under the shared filter, including another tenant's", async () => {
      const store = await makeStore()
      const mine = store.create("alice", meta({ name: "mine.txt" }), "x")
      const shared = store.create("bob", meta({ name: "shared.txt" }), "x")
      store.setVisibility("bob", shared.id, "org")

      const org = store.page("alice", { limit: 10, offset: 0, filter: "org" })
      expect(org.files.map((f) => f.name)).toEqual(["shared.txt"])
      expect(org.files.map((f) => f.id)).not.toContain(mine.id)
    })

    it("carries the recurring topics as chips, sorted, regardless of the active filter", async () => {
      const store = await makeStore()
      // `alpha` recurs; `zeta` and `mu` are used once, so they stay off the bar.
      store.create("alice", meta({ name: "a.txt", labels: ["zeta", "alpha"] }), "x")
      store.create("alice", meta({ name: "b.txt", labels: ["alpha", "mu"] }), "x")

      const { labels } = store.page("alice", { limit: 10, offset: 0, filter: "operator" })
      expect(labels).toEqual(["alpha"])
    })

    it("keeps machine-shaped labels out of the Topics bar even when they recur", async () => {
      const store = await makeStore()
      const ids = ["2026-09-06", "room-a2vADHQC7hBlN6RFmUGo"]
      store.create("alice", meta({ name: "a.txt", labels: ["audio", ...ids] }), "x")
      store.create("alice", meta({ name: "b.txt", labels: ["audio", ...ids] }), "x")

      expect(store.page("alice", { limit: 10, offset: 0 }).labels).toEqual(["audio"])
    })

    it("ranks files by full-text relevance when given a query", async () => {
      const store = await makeStore()
      store.create("alice", meta({ name: "budget.txt" }), "the quarterly budget review")
      store.create("alice", meta({ name: "notes.txt" }), "unrelated meeting notes")

      const hit = store.page("alice", { limit: 10, offset: 0, q: "budget" })
      expect(hit.files.map((f) => f.name)).toEqual(["budget.txt"])
      expect(hit.total).toBe(1)
    })

    it("intersects a query with the other filters", async () => {
      const store = await makeStore()
      store.create("alice", meta({ name: "a.txt", agent: "devops" }), "shared budget plan")
      store.create("alice", meta({ name: "b.txt", agent: "sec" }), "shared budget plan")

      const scoped = store.page("alice", { limit: 10, offset: 0, q: "budget", agent: "devops" })
      expect(scoped.files.map((f) => f.name)).toEqual(["a.txt"])
    })
  })

  describe("labels", () => {
    it("stores labels given at creation, tidied", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta({ labels: [" taxes ", "2025", "taxes", ""] }), "x")
      expect(file.labels).toEqual(["taxes", "2025"])
    })

    it("defaults to no labels", async () => {
      const store = await makeStore()
      expect(store.create("alice", meta(), "x").labels).toEqual([])
    })

    it("filters a listing to a topic", async () => {
      const store = await makeStore()
      store.create("alice", meta({ name: "a.txt", labels: ["invoices"] }), "x")
      store.create("alice", meta({ name: "b.txt", labels: ["notes"] }), "x")

      const invoices = store.list("alice", { label: "invoices" })
      expect(invoices.map((f) => f.name)).toEqual(["a.txt"])
    })

    it("filters a listing to files at or after a timestamp", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta({ name: "old.txt" }), "x")
      const future = new Date(Date.now() + 1000).toISOString()

      expect(store.list("alice", { since: file.createdAt }).map((f) => f.id)).toContain(file.id)
      expect(store.list("alice", { since: future })).toHaveLength(0)
    })

    it("replaces labels, owner-only, tidied", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta({ labels: ["draft"] }), "x")
      const updated = store.setLabels("alice", file.id, ["final", " final ", "sent"])
      expect(updated?.labels).toEqual(["final", "sent"])
    })

    it("an org reader cannot relabel a shared file", async () => {
      const store = await makeStore()
      const file = store.create("alice", meta({ labels: ["mine"] }), "x")
      store.setVisibility("alice", file.id, "org")
      expect(store.setLabels("bob", file.id, ["hijacked"])).toBeUndefined()
      expect(store.get("bob", file.id)?.labels).toEqual(["mine"])
    })
  })

  describe("events", () => {
    it("publishes file.created on write, carrying its labels", async () => {
      const published: EventEnvelopeInput[] = []
      const store = await makeStore(published)
      const file = store.create("alice", meta({ labels: ["invoices"] }), "x")

      expect(published).toHaveLength(1)
      expect(published[0]).toMatchObject({
        type: "file.created",
        tenantId: "alice",
        payload: { fileId: file.id, visibility: "private", labels: ["invoices"] },
      })
    })

    it("publishes an org-scoped file.shared on promotion", async () => {
      const published: EventEnvelopeInput[] = []
      const store = await makeStore(published)
      const file = store.create("alice", meta(), "x")
      published.length = 0
      store.setVisibility("alice", file.id, "org")

      expect(published).toEqual([
        expect.objectContaining({ type: "file.shared", scope: "org", tenantId: "alice" }),
      ])
    })

    it("does not publish when a file returns to private", async () => {
      const published: EventEnvelopeInput[] = []
      const store = await makeStore(published)
      const file = store.create("alice", meta(), "x")
      store.setVisibility("alice", file.id, "org")
      published.length = 0
      store.setVisibility("alice", file.id, "private")

      expect(published).toHaveLength(0)
    })
  })

  it("deleting removes the bytes too", async () => {
    const store = await makeStore()
    const file = store.create("alice", meta(), "x")
    store.remove("alice", file.id)
    expect(await store.bytes("alice", file.id)).toBeUndefined()
  })
})
