import * as React from "react"

export interface ThreadTab {
  id: string
  label: string
  /** open = live chat (working dot); idle = ended or dormant (grey dot). */
  status?: "open" | "idle"
  /** Defaults to true. Set false for the persistent "Main" thread. */
  closable?: boolean
}

export interface ThreadTabsProps {
  tabs?: ThreadTab[]
  activeId?: string
  /** Number shown beside "History" — closed chats available to reopen. */
  historyCount?: number
  onSelect?: (tab: ThreadTab) => void
  onClose?: (tab: ThreadTab) => void
  onNew?: () => void
  onHistory?: () => void
}

export function ThreadTabs(props: ThreadTabsProps): React.ReactElement
