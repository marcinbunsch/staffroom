import * as React from "react"

/**
 * @startingPoint section="Attention" subtitle="Staff AttentionRow" viewport="700x220"
 */
export interface AttentionRowProps {
  /** Chip text: DECISION, QUESTION, FAILED, REVIEW. */
  kind: string
  tone?: "attention" | "failed"
  title: React.ReactNode
  /** One sentence: why it stopped and what happens next. */
  body: React.ReactNode
  agent?: string
  agentInitials?: string
  /** Mono meta nodes: waiting time, job id, exit code. */
  meta?: React.ReactNode
  /** Extra badges beside the title, e.g. <PrivacyBadge/>. */
  badges?: React.ReactNode
  actions?: React.ReactNode
}
