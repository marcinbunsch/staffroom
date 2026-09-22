import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { FilesStore } from "../../src/coordinator/files.ts"
import { SearchIndex } from "../../src/coordinator/search.ts"
import { migratedDatabase } from "../migrated-database.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function wired() {
  const database = await migratedDatabase()
  const dir = mkdtempSync(join(tmpdir(), "staffroom-fs-"))
  dirs.push(dir)
  const search = new SearchIndex(database)
  const files = new FilesStore(database, { dir, search })
  return { files, search }
}

/** Files drive the index: writing a file makes its text searchable, deleting unmakes it. */
describe("files feed search", () => {
  it("indexes a text file's content on write", async () => {
    const { files, search } = await wired()
    files.create(
      "alice",
      { name: "adr.md", contentType: "text/markdown", source: "agent" },
      "we chose Kysely over Drizzle",
    )

    const hits = search.search("alice", "Kysely")
    expect(hits).toHaveLength(1)
    expect(hits[0]?.title).toBe("adr.md")
  })

  it("indexes a binary file by name only, not its bytes", async () => {
    const { files, search } = await wired()
    files.create(
      "alice",
      { name: "diagram", contentType: "image/png", source: "operator" },
      Buffer.from("SECRETMARKER inside the bytes", "utf8"),
    )

    expect(search.search("alice", "diagram")).toHaveLength(1) // by name
    expect(search.search("alice", "SECRETMARKER")).toHaveLength(0) // bytes not indexed
  })

  it("drops a file from search when it is deleted", async () => {
    const { files, search } = await wired()
    const file = files.create(
      "alice",
      { name: "note.txt", contentType: "text/plain", source: "agent" },
      "ephemeral thought",
    )
    expect(search.search("alice", "ephemeral")).toHaveLength(1)

    files.remove("alice", file.id)
    expect(search.search("alice", "ephemeral")).toHaveLength(0)
  })

  it("keeps one tenant's files out of another's search", async () => {
    const { files, search } = await wired()
    files.create(
      "alice",
      { name: "a.txt", contentType: "text/plain", source: "agent" },
      "confidential alpha",
    )
    files.create(
      "bob",
      { name: "b.txt", contentType: "text/plain", source: "agent" },
      "confidential bravo",
    )

    expect(search.search("alice", "confidential").map((h) => h.title)).toEqual(["a.txt"])
  })
})
