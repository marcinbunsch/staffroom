import { describe, expect, it } from "vitest"
import { SearchIndex } from "../../src/coordinator/search.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function makeIndex(): Promise<SearchIndex> {
  return new SearchIndex(await migratedDatabase())
}

describe("the search index", () => {
  it("finds a document by a word in its body", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "deploy notes", "the auth rewrite shipped on Friday")

    const hits = index.search("alice", "rewrite")
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: "file", refId: "f1", title: "deploy notes" })
    expect(hits[0]?.snippet).toContain("rewrite")
  })

  it("finds a document by a word in its title", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "quarterly-budget.xlsx", "")
    expect(index.search("alice", "budget")).toHaveLength(1)
  })

  it("ranks the more relevant document first (bm25 ascending)", async () => {
    const index = await makeIndex()
    // A dense hit (the term is most of the document) versus a passing mention
    // buried in unrelated text. bm25 favours the dense one.
    index.index("file", "dense", "alice", "a", "database database database")
    index.index("file", "passing", "alice", "b", `database ${"lorem ipsum ".repeat(40)}`)

    const hits = index.search("alice", "database")
    expect(hits[0]?.refId).toBe("dense")
    expect(hits[0]!.score).toBeLessThan(hits[1]!.score)
  })

  it("requires every term (implicit AND)", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "t", "alpha bravo")
    index.index("file", "f2", "alice", "t", "alpha charlie")

    expect(index.search("alice", "alpha bravo").map((h) => h.refId)).toEqual(["f1"])
  })

  it("never returns another tenant's content", async () => {
    const index = await makeIndex()
    index.index("file", "mine", "alice", "t", "secret plans")
    index.index("file", "theirs", "bob", "t", "secret plans")

    const hits = index.search("alice", "secret")
    expect(hits.map((h) => h.refId)).toEqual(["mine"])
  })

  it("replaces a row's text on re-index rather than duplicating", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "t", "original body")
    index.index("file", "f1", "alice", "t", "updated body")

    expect(index.search("alice", "original")).toHaveLength(0)
    expect(index.search("alice", "updated")).toHaveLength(1)
  })

  it("drops a removed row from results", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "t", "findable")
    index.remove("file", "f1")
    expect(index.search("alice", "findable")).toHaveLength(0)
  })

  /**
   * A raw query can contain FTS5 operators that are a syntax error or change
   * the meaning. Tokenising to quoted terms makes any input safe.
   */
  it("does not choke on FTS5 syntax in the query", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "t", "the answer is here")

    for (const query of ['"', "AND OR NOT", "answer*", "col:val", "((("]) {
      expect(() => index.search("alice", query)).not.toThrow()
    }
    // A query that reduces to real terms still matches.
    expect(index.search("alice", '"answer"')).toHaveLength(1)
  })

  it("returns nothing for an empty or symbol-only query", async () => {
    const index = await makeIndex()
    index.index("file", "f1", "alice", "t", "body")
    expect(index.search("alice", "   ")).toEqual([])
    expect(index.search("alice", "!!!")).toEqual([])
  })
})
