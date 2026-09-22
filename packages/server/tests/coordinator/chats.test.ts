import { describe, expect, it } from "vitest"
import { ChatStore, MainChatError } from "../../src/coordinator/chats.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function store(): Promise<ChatStore> {
  return new ChatStore(await migratedDatabase())
}

describe("the chat store", () => {
  it("lazy-creates the main chat with the bare session", async () => {
    const chats = await store()
    const main = chats.main("alice", "pm")
    expect(main.kind).toBe("main")
    expect(main.session).toBe("alice:pm") // adopts the pre-existing conversation
    expect(main.closedAt).toBeNull()
    // Idempotent — same row on a second call.
    expect(chats.main("alice", "pm").id).toBe(main.id)
  })

  it("opens side chats with a __t<id> session, main first in the tab list", async () => {
    const chats = await store()
    const side = chats.openSide("alice", "pm", "Research")
    expect(side.kind).toBe("side")
    expect(side.session).toBe(`alice:pm__t${side.id}`)
    expect(side.title).toBe("Research")

    const list = chats.list("alice", "pm")
    expect(list.map((c) => c.kind)).toEqual(["main", "side"]) // main first
  })

  it("start-over closes the main and opens a fresh one as __c<id>", async () => {
    const chats = await store()
    const first = chats.main("alice", "pm")
    const fresh = chats.clearMain("alice", "pm")

    expect(fresh.id).not.toBe(first.id)
    expect(fresh.kind).toBe("main")
    expect(fresh.closedAt).toBeNull()
    expect(fresh.session).toBe(`alice:pm__c${fresh.id}`) // a later main is suffixed
    // Exactly one open main.
    expect(chats.list("alice", "pm").filter((c) => c.kind === "main")).toHaveLength(1)
    // The old main is now in history.
    expect(chats.history("alice", "pm", { limit: 10, offset: 0 }).total).toBe(1)
  })

  it("refuses to close or delete the live main chat", async () => {
    const chats = await store()
    const main = chats.main("alice", "pm")
    expect(() => chats.close("alice", main.id)).toThrow(MainChatError)
    expect(() => chats.delete("alice", main.id)).toThrow(MainChatError)
  })

  it("closes a side chat, then reopen demotes it to a side chat", async () => {
    const chats = await store()
    const side = chats.openSide("alice", "pm")
    const closed = chats.close("alice", side.id)
    expect(closed?.closedAt).not.toBeNull()
    // Dropped from the tabs.
    expect(chats.list("alice", "pm").some((c) => c.id === side.id)).toBe(false)

    const reopened = chats.reopen("alice", side.id)
    expect(reopened?.kind).toBe("side")
    expect(reopened?.closedAt).toBeNull()
  })

  it("keeps a cleared main out of the tabs but in history, and reopens it as a side", async () => {
    const chats = await store()
    chats.main("alice", "pm")
    const oldMainId = chats.main("alice", "pm").id
    chats.clearMain("alice", "pm")

    // The cleared main is history, not a tab.
    const history = chats.history("alice", "pm", { limit: 10, offset: 0 })
    expect(history.chats.some((c) => c.id === oldMainId)).toBe(true)
    // Reopening a cleared main makes it a side chat (never a second open main).
    expect(chats.reopen("alice", oldMainId)?.kind).toBe("side")
    expect(chats.list("alice", "pm").filter((c) => c.kind === "main")).toHaveLength(1)
    // And a reopened chat is a live tab, so it leaves history — never in both.
    expect(chats.list("alice", "pm").some((c) => c.id === oldMainId)).toBe(true)
    expect(
      chats.history("alice", "pm", { limit: 10, offset: 0 }).chats.some((c) => c.id === oldMainId),
    ).toBe(false)
  })

  it("history is closed chats only — an open side chat is never in it", async () => {
    const chats = await store()
    const side = chats.openSide("alice", "pm", "live")
    // Open → in the tabs, not history.
    expect(chats.history("alice", "pm", { limit: 10, offset: 0 }).total).toBe(0)
    chats.close("alice", side.id)
    // Closed → in history, not the tabs.
    expect(chats.history("alice", "pm", { limit: 10, offset: 0 }).total).toBe(1)
  })

  it("orders history by last activity, and touch updates it", async () => {
    const chats = await store()
    const a = chats.openSide("alice", "pm", "A")
    const b = chats.openSide("alice", "pm", "B")
    chats.close("alice", a.id)
    chats.close("alice", b.id)

    // b closed later, so without touch it is first; touch a to move it up.
    chats.touch(a.session, "2999-01-01T00:00:00.000Z")
    const history = chats.history("alice", "pm", { limit: 10, offset: 0 })
    expect(history.chats[0]?.id).toBe(a.id)
  })

  it("scopes by tenant — bob cannot see alice's chats", async () => {
    const chats = await store()
    const side = chats.openSide("alice", "pm", "secret")
    expect(chats.get("bob", side.id)).toBeUndefined()
    expect(chats.list("bob", "pm").some((c) => c.id === side.id)).toBe(false)
    // bySession is by unique session and is not tenant-scoped (the audit tap has only a session).
    expect(chats.bySession(side.session)?.id).toBe(side.id)
  })

  it("searchByTitle finds open chats across agents, case-insensitive and tenant-scoped", async () => {
    const chats = await store()
    chats.openSide("alice", "pm", "Quarterly planning")
    chats.openSide("alice", "devops", "PLANNING the migration")
    const closed = chats.openSide("alice", "pm", "Old plan")
    chats.close("alice", closed.id) // history is excluded from search

    const hits = chats.searchByTitle("alice", "plan")
    expect(hits.map((c) => c.title).sort()).toEqual([
      "PLANNING the migration",
      "Quarterly planning",
    ])
    // A closed chat is not a search hit.
    expect(hits.some((c) => c.title === "Old plan")).toBe(false)
    // Tenant-scoped, and an empty query is no query.
    expect(chats.searchByTitle("bob", "plan")).toHaveLength(0)
    expect(chats.searchByTitle("alice", "   ")).toHaveLength(0)
  })

  it("searchByTitle treats LIKE wildcards as literal characters", async () => {
    const chats = await store()
    chats.openSide("alice", "pm", "100% coverage")
    chats.openSide("alice", "pm", "Just planning")
    // A literal % matches the percent sign, not every title.
    expect(chats.searchByTitle("alice", "100%").map((c) => c.title)).toEqual(["100% coverage"])
  })
})
