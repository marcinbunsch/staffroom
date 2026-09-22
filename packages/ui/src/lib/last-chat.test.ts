import { describe, expect, it } from "vitest"
import type { TabChatRow } from "./api.ts"
import { chatOnClose } from "./last-chat.ts"

const chat = (id: number, kind: TabChatRow["kind"]): TabChatRow =>
  ({ id, kind, title: `#${id}`, session: `s${id}` }) as TabChatRow

// Main-first strip: [main 1, side 2, side 3].
const chats = [chat(1, "main"), chat(2, "side"), chat(3, "side")]

describe("chatOnClose", () => {
  it("lands on the left neighbour", () => {
    expect(chatOnClose(chats, 3)?.id).toBe(2)
  })

  it("lands on the main chat when the first side chat closes", () => {
    expect(chatOnClose(chats, 2)?.id).toBe(1)
  })

  it("falls back past an id that is not in the strip", () => {
    expect(chatOnClose(chats, 99)?.id).toBe(1)
  })

  it("returns undefined when nothing else is open", () => {
    expect(chatOnClose([chat(2, "side")], 2)).toBeUndefined()
  })
})
