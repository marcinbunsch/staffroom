import { useState } from "react"
import { Button, KindChip } from "../design/index.ts"
import type { AttentionRow } from "../lib/api.ts"
import { attentionTone } from "../lib/status.ts"

/**
 * An agent-raised request (the `attention_request` escalation): the agent needs
 * a person and stopped. Unlike an approval's approve/deny, the operator either
 * **resolves** it — answers it, which resumes the agent with the note — or
 * **dismisses** it, standing the agent down with a required reason. Ported from
 * the prototype's AttentionActions; shared by the chat, a job, and the board.
 */
export function RequestCard({
  item,
  onResolve,
  onDismiss,
}: {
  item: AttentionRow
  onResolve: (item: AttentionRow, note?: string) => Promise<void>
  onDismiss: (item: AttentionRow, note: string) => Promise<void>
}) {
  const [mode, setMode] = useState<"resolve" | "dismiss">()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  function open(next: "resolve" | "dismiss") {
    setNote("")
    setMode(next)
  }

  async function confirm() {
    if (mode === "dismiss" && !note.trim()) return
    setBusy(true)
    try {
      if (mode === "dismiss") await onDismiss(item, note.trim())
      else await onResolve(item, note.trim() || undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border border-status-attention bg-surface-panel px-4 py-3">
      <div className="flex items-start gap-2">
        <KindChip tone={attentionTone(item.kind)}>{item.kind.toUpperCase()}</KindChip>
        <div className="min-w-0 flex-1">
          <div className="text-secondary font-medium text-ink-primary">{item.title}</div>
          {item.detail && (
            <div className="mt-0.5 whitespace-pre-wrap text-meta text-ink-muted">{item.detail}</div>
          )}
        </div>
      </div>

      {mode ? (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            autoFocus
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              mode === "dismiss"
                ? "Why is this dismissed? (the agent adapts to this)"
                : "Answer the agent — it resumes with this (optional)…"
            }
            className="w-full resize-y rounded-control border border-line-strong bg-surface-card px-3 py-2 text-secondary text-ink-primary outline-none focus:border-line-accent"
          />
          <div className="flex gap-2 self-end">
            <Button variant="ghost" disabled={busy} onClick={() => setMode(undefined)}>
              Cancel
            </Button>
            <Button
              variant={mode === "dismiss" ? "danger" : "primary"}
              disabled={busy || (mode === "dismiss" && !note.trim())}
              onClick={() => void confirm()}
            >
              {busy
                ? mode === "dismiss"
                  ? "Dismissing…"
                  : "Resolving…"
                : mode === "dismiss"
                  ? "Dismiss"
                  : "Resolve & resume"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2 self-end">
          <Button variant="ghost" disabled={busy} onClick={() => open("dismiss")}>
            Dismiss
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => open("resolve")}>
            Resolve
          </Button>
        </div>
      )}
    </div>
  )
}
