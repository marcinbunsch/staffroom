import type { ReactNode } from "react"
import { Avatar } from "../core/Avatar.tsx"
import { Button } from "../core/Button.tsx"

/* Work is always addressed to a named agent, so the picker is part of the
   composer rather than a separate step. Send is disabled until there is text.

   This is the design-system reference shape. The app's live message box
   (components/Composer.tsx) carries the stateful behaviour (mentions,
   auto-grow) and adopts this look. */

export interface ComposerProps {
  /** Agent that will receive the message — always visible. */
  agent?: string
  agentInitials?: string
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  onSend?: () => void
  /** Extra controls, e.g. Attach to Inbox. */
  tools?: ReactNode
}

export function Composer({
  agent,
  agentInitials,
  placeholder,
  value = "",
  onChange,
  onSend,
  tools,
}: ComposerProps) {
  return (
    <div className="flex items-center gap-3.5 rounded-panel border border-line-strong bg-surface-card px-4 py-3.5">
      {agent ? (
        <div className="flex cursor-pointer items-center gap-2 rounded-[9px] border border-line-strong bg-surface-inset px-[11px] py-[7px] text-secondary whitespace-nowrap hover:bg-surface-control">
          <Avatar initials={agentInitials ?? ""} size="sm" />
          {agent}
          <span className="text-mono text-ink-faint">▾</span>
        </div>
      ) : null}
      <input
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        className="flex-1 border-none bg-transparent font-sans text-body text-ink-primary outline-none placeholder:text-ink-label"
      />
      {tools}
      <Button variant="primary" disabled={!value} onClick={onSend}>
        Send
      </Button>
    </div>
  )
}
