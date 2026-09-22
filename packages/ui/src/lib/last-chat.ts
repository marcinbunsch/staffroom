import type { TabChatRow } from "./api.ts"

/**
 * The last chat the operator viewed for each agent, in localStorage — so a bare
 * `/a/:agentId` (no chat id) reopens where they left off rather than snapping
 * back to the main thread every time.
 */
const KEY = "staffroom-last-chat"

function read(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>
  } catch {
    return {}
  }
}

export function rememberChat(agent: string, chatId: number): void {
  const map = read()
  map[agent] = chatId
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // A full or unavailable localStorage is not worth failing a navigation over.
  }
}

export function lastChatId(agent: string): number | undefined {
  return read()[agent]
}

/**
 * Which chat to show: the one named in the URL, else the last-viewed one, else
 * the main chat. A stale or closed id falls through to the main chat.
 */
export function chatOnShow(
  chats: TabChatRow[],
  requested?: number,
  last?: number,
): TabChatRow | undefined {
  const byId = (id?: number) => (id === undefined ? undefined : chats.find((c) => c.id === id))
  return byId(requested) ?? byId(last) ?? chats.find((c) => c.kind === "main") ?? chats[0]
}
