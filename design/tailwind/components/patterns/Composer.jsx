import React from "react"
import { Avatar } from "../core/Avatar.jsx"

/* Work is always addressed to a named agent, so the picker is part of the
   composer rather than a separate step.

   Attaching is a utility, not the composer's purpose: it is a quiet 32px ghost
   icon button (ti-paperclip — never the 📎 emoji, which renders in the
   platform's own colour, and colour here is reserved for status). Staged files
   appear as chips above the field so they can be seen and removed before
   sending. Dropping files swaps the control row for a single dashed target.

   There is one way to attach a file: the paperclip, a drop, or a paste. Pasted
   files and screenshots become attachments; pasted text goes in the field.

   Paste transcript is the one exception, and it isn't an attachment: it pulls a
   conversation out of the clipboard into the agent's context. It sits beside
   the paperclip as a second ghost icon — a label there would out-weigh Send. */

function Attachment({ file, onRemove }) {
  return (
    <span className="group/att flex max-w-[240px] items-center gap-2 rounded-chip border border-line-default bg-surface-inset py-1 pr-1 pl-2">
      <i className={`ti ti-${file.icon || "file"} shrink-0 text-[13px] text-ink-faint`} />
      <span className="min-w-0 truncate text-meta text-ink-secondary">{file.name}</span>
      {file.size && (
        <span className="shrink-0 font-mono text-mono text-ink-label">{file.size}</span>
      )}
      <button
        type="button"
        aria-label={`Remove ${file.name}`}
        title="Remove"
        onClick={() => onRemove?.(file)}
        className="grid h-[18px] w-[18px] shrink-0 cursor-pointer place-items-center rounded-chip border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-control hover:text-ink-primary"
      >
        <i className="ti ti-x text-[11px]" />
      </button>
    </span>
  )
}

export function Composer({
  agent,
  agentInitials,
  placeholder,
  value = "",
  attachments = [],
  onChange,
  onSend,
  onAttach,
  onRemoveAttachment,
  onPasteTranscript,
}) {
  const [dragging, setDragging] = React.useState(false)
  const fileInput = React.useRef(null)

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onAttach?.(Array.from(e.dataTransfer.files))
      }}
      onPaste={(e) => {
        /* files and screenshots attach; text falls through to the field */
        const files = Array.from(e.clipboardData?.files || [])
        if (files.length) {
          e.preventDefault()
          onAttach?.(files)
        }
      }}
      className={
        "rounded-panel border px-3.5 py-3 " +
        (dragging ? "border-line-accent bg-surface-hover" : "border-line-strong bg-surface-card")
      }
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-2.5">
          {attachments.map((f) => (
            <Attachment key={f.name} file={f} onRemove={onRemoveAttachment} />
          ))}
        </div>
      )}

      <div className="flex items-start gap-3.5">
        {agent && (
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-[9px] border border-line-strong bg-surface-inset px-[11px] py-[7px] font-sans text-secondary whitespace-nowrap text-ink-primary transition-[background-color] duration-[120ms] ease-out hover:bg-surface-control"
          >
            <Avatar initials={agentInitials} size="sm" />
            {agent}
            <span className="font-mono text-mono text-ink-faint">▾</span>
          </button>
        )}
        <textarea
          rows={3}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
          className="min-h-[76px] min-w-0 flex-1 resize-none border-none bg-transparent px-1 font-sans text-body text-ink-primary outline-none placeholder:text-ink-label"
        />
      </div>

      {dragging ? (
        <div className="mt-3 flex items-center gap-2 rounded-control border border-dashed border-line-accent px-3 py-2.5 font-mono text-mono text-ink-muted">
          <i className="ti ti-upload text-[14px]" />
          <span>Drop to attach</span>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => onAttach?.(Array.from(e.target.files))}
          />
          <button
            type="button"
            aria-label="Attach files"
            title="Attach files"
            onClick={() => fileInput.current?.click()}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"
          >
            <i className="ti ti-paperclip text-[16px]" />
          </button>
          {onPasteTranscript && (
            <button
              type="button"
              aria-label="Paste transcript"
              title="Paste transcript"
              onClick={onPasteTranscript}
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"
            >
              <i className="ti ti-clipboard-text text-[16px]" />
            </button>
          )}
          {onPasteTranscript && (
            <button
              type="button"
              aria-label="Paste transcript"
              title="Paste transcript"
              onClick={onPasteTranscript}
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"
            >
              <i className="ti ti-clipboard-text text-[16px]" />
            </button>
          )}
          <button
            type="button"
            disabled={!value}
            onClick={onSend}
            className={
              "ml-auto shrink-0 rounded-control border-0 px-[15px] py-[7px] font-sans text-secondary font-medium transition-[background-color] duration-[120ms] ease-out " +
              (value
                ? "cursor-pointer bg-surface-control-hover text-ink-primary hover:bg-surface-control-active"
                : "cursor-default bg-surface-control text-ink-disabled")
            }
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}
