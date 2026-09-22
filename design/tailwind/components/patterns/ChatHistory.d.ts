import * as React from "react"

export interface ChatHistoryItem {
  id: string
  title: string
  /** open = live conversation (working dot); closed = ended (idle dot). */
  status: "open" | "closed"
  /** Short relative timestamp, e.g. "4 min", "2 h", "Yesterday". */
  time: string
  /** Optional mono chip after the title — a branch, worktree or scope. */
  branch?: string
  /** Second-line detail after the status, e.g. "12 messages". */
  meta?: string
}

export interface ChatHistoryGroup {
  /** Mono uppercase subhead, e.g. "Today", "Earlier". */
  label: string
  chats: ChatHistoryItem[]
}

export interface ChatHistoryProps {
  /** Closable chats only — never the persistent "Main" thread. */
  groups?: ChatHistoryGroup[]
  onOpen?: (chat: ChatHistoryItem) => void
  onDelete?: (chat: ChatHistoryItem) => void
  onClose?: () => void
}

export function ChatHistory(props: ChatHistoryProps): React.ReactElement
