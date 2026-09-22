import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { fileSize } from "../lib/format.ts"
import { useIsDesktop } from "../lib/use-desktop.ts"
import { useStores } from "../stores/context.tsx"
import { CodexUsageGauge } from "./CodexUsageGauge.tsx"
import { ConfirmDialog } from "./ConfirmDialog.tsx"

// Icon buttons on the control row — the quiet 32px ghost used for + in the tabs.
const ICON_BUTTON =
  "grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-hover hover:text-ink-primary"

export interface ComposerMention {
  id: string
  name: string
}

/**
 * The one message box — used by chat and any steer box. A full-width text area
 * over a row of controls: messages to an agent run several sentences, and the
 * row underneath is where per-view controls (`tools`) and attachments live.
 *
 * Ported from the prototype. Send key is responsive: on desktop Enter sends and
 * Shift+Enter is a newline; on mobile Enter is a newline and the Send button
 * sends. Clears on send; a failed send restores the text and files.
 */
export function Composer({
  placeholder,
  onSend,
  tools,
  mentions = [],
  autoFocus = false,
  allowAttachments = false,
  draftKey,
}: {
  placeholder: string
  onSend: (text: string, files: File[]) => void | Promise<void>
  tools?: ReactNode
  mentions?: readonly ComposerMention[]
  /** Focus the text area on mount — for screens whose point is typing a message. */
  autoFocus?: boolean
  /** Show the attach affordance and accept dropped files (chat only, for now). */
  allowAttachments?: boolean
  /**
   * Persist the unsent text under this key (per conversation) so a draft
   * survives navigating away and back. Omit it for a throwaway box (a steer).
   * Remount on a key change (a `key` prop) to reseed from the new draft.
   */
  draftKey?: string
}) {
  const isDesktop = useIsDesktop()
  const { drafts } = useStores()
  const [text, setText] = useState(() => (draftKey ? drafts.get(draftKey) : ""))
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string>()
  // Clipboard contents waiting for a filename before they become an attachment.
  const [pasted, setPasted] = useState<{ blob: Blob; type: string } | undefined>(undefined)
  const [pastedName, setPastedName] = useState("")
  const [dragging, setDragging] = useState(false)
  const [caret, setCaret] = useState(0)
  const [activeMention, setActiveMention] = useState(0)
  const [mentionsDismissed, setMentionsDismissed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    const input = textarea.current
    if (!input) return
    input.focus()
    // Land the cursor after a restored draft, not before it, so typing continues
    // where it left off. Harmless on an empty box (end is 0).
    const end = input.value.length
    input.setSelectionRange(end, end)
    setCaret(end)
  }, [autoFocus])

  // Persist the draft on every change; an empty value clears it, so a sent or
  // cleared box leaves nothing behind, and a failed send (which restores the
  // text) re-saves it.
  useEffect(() => {
    if (draftKey) drafts.save(draftKey, text)
  }, [draftKey, text, drafts])

  // When the paste-as-file dialog closes (cancel or attach), return focus to the
  // text box so typing continues. The rAF lets Radix finish its own focus
  // restoration (to the button/shortcut origin) first, then we override it.
  const hadPasted = useRef(false)
  useEffect(() => {
    if (pasted) {
      hadPasted.current = true
      return
    }
    if (hadPasted.current) {
      hadPasted.current = false
      requestAnimationFrame(() => textarea.current?.focus())
    }
  }, [pasted])

  const mention = useMemo(() => mentionAtCaret(text, caret), [text, caret])
  const suggestions = useMemo(() => {
    if (!mention || mentionsDismissed) return []
    const query = mention.query.toLowerCase()
    return mentions.filter(
      (candidate) =>
        candidate.id.toLowerCase().startsWith(query) ||
        candidate.name.toLowerCase().includes(query),
    )
  }, [mention, mentions, mentionsDismissed])

  // Grows with the text up to a third of the window. The single-line floor is a
  // CSS min-height, so the box never collapses below one line.
  useLayoutEffect(() => {
    const input = textarea.current
    if (!input) return
    input.style.height = "auto"
    const max = window.innerHeight * 0.3
    input.style.height = `${Math.min(input.scrollHeight, max)}px`
    input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden"
  }, [text])

  async function submit() {
    const value = text.trim()
    if (!value && files.length === 0) return
    const pending = files
    setText("")
    setFiles([])
    setError(undefined)
    try {
      await onSend(value, pending)
    } catch (caught) {
      // A failed send keeps both the text and the attachments so nothing is lost.
      setText(value)
      setFiles(pending)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setFiles((current) => [...current, ...Array.from(list)])
  }
  function removeFile(index: number) {
    setFiles((current) => current.filter((_, at) => at !== index))
  }

  // Read the clipboard (an image if it holds one, otherwise its text) and ask
  // for a filename before attaching. Reading needs the click's user gesture, so
  // it happens here rather than behind the dialog.
  async function pasteAsFile() {
    setError(undefined)
    try {
      const found = await readClipboard()
      if (!found) {
        setError("Your clipboard has nothing to attach.")
        return
      }
      setPasted({ blob: found.blob, type: found.type })
      setPastedName(found.defaultName)
    } catch {
      setError("Couldn't read the clipboard — check the browser's clipboard permission.")
    }
  }

  function attachPasted() {
    if (!pasted) return
    const name = pastedName.trim()
    if (!name) return
    setFiles((current) => [
      ...current,
      new File([pasted.blob], name, { type: mediaTypeForName(name, pasted.type) }),
    ])
  }

  function updateText(value: string, nextCaret: number) {
    setText(value)
    setCaret(nextCaret)
    setActiveMention(0)
    setMentionsDismissed(false)
  }

  function selectMention(candidate: ComposerMention) {
    if (!mention) return
    const value = `${text.slice(0, mention.start)}@${candidate.id} ${text.slice(caret)}`
    const nextCaret = mention.start + candidate.id.length + 2
    updateText(value, nextCaret)
    requestAnimationFrame(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  return (
    <>
      <form
        className={`rounded-panel border px-3.5 py-3 ${
          dragging ? "border-line-accent bg-surface-hover" : "border-line-strong bg-surface-card"
        }`}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onDragOver={
          allowAttachments
            ? (event) => {
                event.preventDefault()
                setDragging(true)
              }
            : undefined
        }
        onDragLeave={
          allowAttachments
            ? (event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
              }
            : undefined
        }
        onDrop={
          allowAttachments
            ? (event) => {
                event.preventDefault()
                setDragging(false)
                addFiles(event.dataTransfer.files)
              }
            : undefined
        }
      >
        {/* Staged files sit above the field as chips: type icon, name, size, and
            a remove ×, so what you'll send is visible before you send it. */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-2.5">
            {files.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="flex max-w-[240px] items-center gap-2 rounded-chip border border-line-default bg-surface-inset py-1 pr-1 pl-2"
              >
                <i className={`ti ${fileIcon(file)} shrink-0 text-[13px] text-ink-faint`} />
                <span className="min-w-0 truncate text-meta text-ink-secondary">{file.name}</span>
                <span className="shrink-0 font-mono text-mono text-ink-label">
                  {fileSize(file.size)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  onClick={() => removeFile(index)}
                  className="grid h-[18px] w-[18px] shrink-0 cursor-pointer place-items-center rounded-chip border-0 bg-transparent p-0 text-ink-faint transition-[background-color,color] duration-[120ms] ease-out hover:bg-surface-control hover:text-ink-primary"
                >
                  <i className="ti ti-x text-[11px]" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative min-w-0">
          {suggestions.length > 0 && (
            <div
              className="absolute bottom-[calc(100%+6px)] left-0 z-[1] w-[min(280px,100%)] overflow-hidden rounded-control border border-line-strong bg-surface-card p-1"
              role="listbox"
              aria-label="Mention a staff member"
            >
              {suggestions.map((candidate, index) => (
                <button
                  className={`flex w-full gap-2 rounded-[5px] border-0 px-2 py-1.5 text-left ${
                    index === activeMention
                      ? "bg-surface-hover"
                      : "bg-transparent hover:bg-surface-hover"
                  }`}
                  key={candidate.id}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectMention(candidate)
                  }}
                  role="option"
                  aria-selected={index === activeMention}
                  type="button"
                >
                  <span className="font-mono text-ink-monogram">@{candidate.id}</span>
                  <span className="text-ink-secondary">{candidate.name}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            rows={1}
            placeholder={placeholder}
            value={text}
            className="block max-h-[30vh] w-full resize-none border-none bg-transparent px-1 font-sans text-body text-ink-primary outline-none placeholder:text-ink-label"
            onChange={(event) => updateText(event.target.value, event.target.selectionStart)}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            onPaste={
              allowAttachments
                ? (event) => {
                    const list = event.clipboardData.files
                    if (list.length > 0) {
                      event.preventDefault()
                      addFiles(list)
                    }
                  }
                : undefined
            }
            onKeyDown={(event) => {
              // Cmd/Ctrl+Shift+V — paste the clipboard as a named attachment,
              // instead of the browser's plain-text paste into the field.
              if (
                allowAttachments &&
                (event.metaKey || event.ctrlKey) &&
                event.shiftKey &&
                event.code === "KeyV"
              ) {
                event.preventDefault()
                void pasteAsFile()
                return
              }
              if (suggestions.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault()
                  const direction = event.key === "ArrowDown" ? 1 : -1
                  setActiveMention(
                    (current) => (current + direction + suggestions.length) % suggestions.length,
                  )
                  return
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault()
                  const candidate = suggestions[activeMention] ?? suggestions[0]
                  if (candidate) selectMention(candidate)
                  return
                }
                if (event.key === "Escape") {
                  event.preventDefault()
                  setMentionsDismissed(true)
                  return
                }
              }
              // Desktop: Enter sends, Shift+Enter is a newline. Mobile: Enter is
              // a newline (the textarea's own behaviour) and Send sends, so a
              // thumb never fires a message mid-thought.
              if (event.key === "Enter" && !event.shiftKey && isDesktop) {
                event.preventDefault()
                void submit()
              }
            }}
          />
        </div>
        {allowAttachments && (
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files)
              event.target.value = ""
            }}
          />
        )}
        {/* While a drag is over the panel, the control row yields to one
            instruction, so there's a single target on screen. */}
        {dragging ? (
          <div className="mt-3 flex items-center gap-2 rounded-control border border-dashed border-line-accent px-3 py-2.5 font-mono text-mono text-ink-muted">
            <i className="ti ti-upload text-[14px]" />
            <span>Drop to attach</span>
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-1">
            {allowAttachments && (
              <>
                <button
                  type="button"
                  aria-label="Attach files"
                  title="Attach files"
                  onClick={() => fileInput.current?.click()}
                  className={ICON_BUTTON}
                >
                  <i className="ti ti-paperclip text-[16px]" />
                </button>
                <button
                  type="button"
                  aria-label="Paste as file"
                  title="Paste clipboard as a file (⌘⇧V)"
                  onClick={() => void pasteAsFile()}
                  className={ICON_BUTTON}
                >
                  <i className="ti ti-clipboard-text text-[16px]" />
                </button>
                <CodexUsageGauge />
              </>
            )}
            {tools}
            <span className="ml-auto" />
            <button
              type="button"
              disabled={!text.trim() && files.length === 0}
              onClick={() => void submit()}
              className={`shrink-0 rounded-control border-0 px-[15px] py-[7px] font-sans text-secondary font-medium transition-[background-color] duration-[120ms] ease-out ${
                !text.trim() && files.length === 0
                  ? "cursor-default bg-surface-control text-ink-disabled"
                  : "cursor-pointer bg-surface-control-hover text-ink-primary hover:bg-surface-control-active"
              }`}
            >
              Send
            </button>
          </div>
        )}
      </form>
      {error && <div className="mt-1.5 text-meta text-status-failed">{error}</div>}

      {pasted && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setPasted(undefined)}
          title="Attach clipboard as a file"
          description={
            <>
              {pasted.type.startsWith("image/") ? "An image" : "Text"} from your clipboard (
              {fileSize(pasted.blob.size)}) — name it, then attach.
            </>
          }
          confirmLabel="Attach"
          confirmDisabled={!pastedName.trim()}
          onConfirm={attachPasted}
        >
          <input
            autoFocus
            value={pastedName}
            onChange={(event) => setPastedName(event.target.value)}
            onFocus={(event) => {
              // The name is `pasted-<stamp>.<ext>`; highlight only the leading
              // "pasted" word so a rename types over it and keeps the stamp.
              const end = event.target.value.indexOf("-")
              event.target.setSelectionRange(0, end === -1 ? event.target.value.length : end)
            }}
            placeholder="filename"
            className="w-full rounded-control border border-line-strong bg-surface-card px-3 py-2 font-mono text-secondary text-ink-primary outline-none placeholder:text-ink-label focus:border-line-accent"
          />
          <div className="mt-2 flex gap-1.5">
            {PASTE_EXTENSIONS.map((ext) => {
              const active = pastedName.toLowerCase().endsWith(`.${ext}`)
              return (
                <button
                  key={ext}
                  type="button"
                  onClick={() => setPastedName((name) => withExtension(name, ext))}
                  className={`rounded-chip border px-2 py-0.5 font-mono text-label ${
                    active
                      ? "border-accent-strong bg-accent-strong text-ink-on-accent"
                      : "border-line-strong text-ink-muted hover:bg-line-subtle"
                  }`}
                >
                  .{ext}
                </button>
              )
            })}
          </div>
        </ConfirmDialog>
      )}
    </>
  )
}

/** A Tabler icon name for an attachment chip, by media type then extension. */
function fileIcon(file: File): string {
  if (file.type.startsWith("image/")) return "ti-photo"
  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  if (extension === "csv" || extension === "tsv") return "ti-table"
  if (extension === "pdf") return "ti-file-type-pdf"
  if (extension === "json") return "ti-code"
  return "ti-file-text"
}

// The extensions the paste-as-file dialog offers as one-click swaps.
const PASTE_EXTENSIONS = ["txt", "md", "json"] as const

/** Replace a filename's extension (or append one if it has none). */
function withExtension(name: string, ext: string): string {
  return `${name.replace(/\.[^./]*$/, "")}.${ext}`
}

const TEXT_EXTENSIONS: Record<string, string> = {
  json: "application/json",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
}

/**
 * The media type to upload the clipboard as. An image keeps its own type; text
 * takes a type from the name's extension, defaulting to text/plain.
 */
function mediaTypeForName(name: string, fallback: string): string {
  if (fallback.startsWith("image/")) return fallback
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  return TEXT_EXTENSIONS[extension] ?? "text/plain"
}

interface ClipboardContent {
  blob: Blob
  type: string
  defaultName: string
}

/** An image from the clipboard if it holds one, else its text — or undefined. */
async function readClipboard(): Promise<ClipboardContent | undefined> {
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read().catch(() => undefined)
    for (const item of items ?? []) {
      const imageType = item.types.find((type) => type.startsWith("image/"))
      if (!imageType) continue
      const blob = await item.getType(imageType)
      return { blob, type: imageType, defaultName: `${timestamp()}.${imageType.split("/")[1]}` }
    }
  }
  const text = await navigator.clipboard.readText().catch(() => "")
  if (!text.trim()) return undefined
  return {
    blob: new Blob([text], { type: "text/plain" }),
    type: "text/plain",
    defaultName: `${timestamp()}.txt`,
  }
}

/** A sortable, filename-safe stamp like pasted-20260831-142530. */
function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `pasted-${date}-${time}`
}

function mentionAtCaret(text: string, caret: number): { start: number; query: string } | undefined {
  const match = /(?:^|\s)@([a-z0-9-]*)$/i.exec(text.slice(0, caret))
  if (!match) return undefined
  const matched = match[0]
  const query = match[1]
  if (matched === undefined || query === undefined) return undefined
  return { start: caret - matched.length + (matched.startsWith("@") ? 0 : 1), query }
}
