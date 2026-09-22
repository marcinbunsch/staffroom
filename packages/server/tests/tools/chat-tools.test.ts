import { describe, expect, it } from "vitest"
import { ChatStore } from "../../src/coordinator/chats.ts"
import { type ChatToolContext, renameCurrentChat } from "../../src/tools/chat-tools.ts"
import { migratedDatabase } from "../migrated-database.ts"

async function makeStore(): Promise<ChatStore> {
  return new ChatStore(await migratedDatabase())
}

describe("rename_chat tool", () => {
  it("renames the chat for the current session, trimming the title", async () => {
    const store = await makeStore()
    const chat = store.openSide("alice", "pm", "New chat")
    const context: ChatToolContext = { tenantId: "alice", agent: "pm", session: chat.session }

    const result = renameCurrentChat(store, context, "  Quarterly planning  ")
    expect(result.message).toBe('Renamed this chat to "Quarterly planning".')
    expect(result.renamedAgent).toBe("pm")
    expect(store.get("alice", chat.id)?.title).toBe("Quarterly planning")
  })

  it("reports when the session maps to no chat, and changes nothing", async () => {
    const store = await makeStore()
    const context: ChatToolContext = { tenantId: "alice", agent: "pm", session: "alice:pm__t999" }

    const result = renameCurrentChat(store, context, "Anything")
    expect(result.renamedAgent).toBeUndefined()
    expect(result.message).toMatch(/no chat to rename/)
  })

  it("rejects an empty or whitespace title without touching the chat", async () => {
    const store = await makeStore()
    const chat = store.openSide("alice", "pm") // defaults to "New chat"
    const context: ChatToolContext = { tenantId: "alice", agent: "pm", session: chat.session }

    const result = renameCurrentChat(store, context, "   ")
    expect(result.renamedAgent).toBeUndefined()
    expect(store.get("alice", chat.id)?.title).toBe("New chat")
  })

  it("won't rename a chat belonging to another tenant", async () => {
    const store = await makeStore()
    const chat = store.openSide("alice", "pm", "Alice's chat")
    // Same session string, but the caller claims to be bob.
    const context: ChatToolContext = { tenantId: "bob", agent: "pm", session: chat.session }

    const result = renameCurrentChat(store, context, "Hijacked")
    expect(result.renamedAgent).toBeUndefined()
    expect(store.get("alice", chat.id)?.title).toBe("Alice's chat")
  })
})
