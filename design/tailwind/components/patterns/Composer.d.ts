import * as React from "react"

export interface ComposerAttachment {
  name: string
  /** Tabler icon name without the `ti-` prefix, e.g. "file-text", "table". */
  icon?: string
  /** Human size label, e.g. "112 KB". */
  size?: string
}

export interface ComposerProps {
  agent?: string
  agentInitials?: string
  placeholder?: string
  value?: string
  /** Files staged for this message, shown as chips above the field. */
  attachments?: ComposerAttachment[]
  onChange?: (value: string) => void
  onSend?: () => void
  /** Called with a File[] from the picker, a drop, or a paste. */
  onAttach?: (files: File[]) => void
  onRemoveAttachment?: (attachment: ComposerAttachment) => void
  /** Pull a conversation from the clipboard into context. Omit to hide the icon. */
  onPasteTranscript?: () => void
}

export function Composer(props: ComposerProps): React.ReactElement
