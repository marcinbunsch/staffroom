import { useEffect, useState } from "react"
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../design/index.ts"
import { type FileRow, api } from "../lib/api.ts"
import { isMarkdownFile, isTextFile } from "../lib/files.ts"
import { canCopyFile, copyAsFile } from "../lib/use-desktop.ts"
import { Markdown } from "./Markdown.tsx"

/**
 * Reading a text file's content, one modal behind every "eye" button — the
 * Files screen, chat attachments, the agent sidebar — so a file reads the same
 * everywhere. Markdown renders rich; every other text type shows raw and
 * faithful. The file's id, raw text, and (in the desktop app) the file itself
 * are copyable from the footer; elsewhere the file can go to the share sheet.
 */

type Load =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; message: string }

/**
 * The controlled viewer: pass the file to read, or `undefined` for closed.
 * Content is fetched lazily whenever a file opens; a new file id re-fetches.
 */
export function FileViewerDialog({
  file,
  onClose,
}: {
  file: FileRow | undefined
  onClose: () => void
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" })

  useEffect(() => {
    if (!file) return
    let live = true
    setLoad({ status: "loading" })
    api.files.text(file.id).then(
      (text) => live && setLoad({ status: "ready", text }),
      () => live && setLoad({ status: "error", message: `Could not read ${file.name}.` }),
    )
    return () => {
      live = false
    }
  }, [file])

  return (
    <Dialog open={file !== undefined} onOpenChange={(next) => !next && onClose()}>
      {file && (
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle className="truncate font-mono">{file.name}</DialogTitle>
            {isTextFile(file) && (
              <a
                href={`/print/${file.id}`}
                target="_blank"
                rel="noreferrer"
                title="Open print view (Save as PDF)"
                aria-label={`Open ${file.name} in a print view`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink-muted no-underline hover:bg-surface-hover hover:text-ink-primary"
              >
                <i className="ti ti-printer text-[16px]" />
              </a>
            )}
            <a
              href={api.files.contentUrl(file.id)}
              target="_blank"
              rel="noreferrer"
              title="Download"
              aria-label={`Download ${file.name}`}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink-muted no-underline hover:bg-surface-hover hover:text-ink-primary"
            >
              <i className="ti ti-download text-[16px]" />
            </a>
          </DialogHeader>
          <DialogBody>
            {load.status === "loading" && (
              <div className="text-secondary text-ink-muted">Loading…</div>
            )}
            {load.status === "error" && (
              <div className="text-secondary text-status-failed">{load.message}</div>
            )}
            {load.status === "ready" &&
              (isMarkdownFile(file) ? (
                <div className="markdown text-secondary [overflow-wrap:anywhere]">
                  <Markdown>{load.text}</Markdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-mono text-ink-secondary">
                  {load.text}
                </pre>
              ))}
          </DialogBody>
          <DialogFooter>
            <CopyId id={file.id} />
            {load.status === "ready" && <CopyRaw text={load.text} />}
            {load.status === "ready" &&
              (canCopyFile() ? (
                <CopyAsFile name={file.name} text={load.text} />
              ) : (
                <ShareFile name={file.name} text={load.text} />
              ))}
            <span className="flex-1" />
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/**
 * A self-contained eye button that owns its own dialog — for the hand-rolled
 * file rows (chat attachments, the sidebar) that are not `ArtifactRow`. Gate it
 * on {@link isTextFile} at the call site; a binary file has nothing to read.
 */
export function FileViewButton({ file, className }: { file: FileRow; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="View"
        aria-label={`View ${file.name}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
        className={
          className ??
          "grid h-7 w-7 shrink-0 place-items-center rounded-control border-0 bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        }
      >
        <i className="ti ti-eye text-[16px]" />
      </button>
      <FileViewerDialog file={open ? file : undefined} onClose={() => setOpen(false)} />
    </>
  )
}

/** The file id with a copy button that flips to a check for a moment. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title="Copy file ID"
      aria-label="Copy file ID"
      onClick={() =>
        void navigator.clipboard.writeText(id).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
      className="flex min-w-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-card px-2.5 py-1.5 font-mono text-mono text-ink-muted hover:bg-surface-control hover:text-ink-primary"
    >
      <i className={`shrink-0 text-[14px] ti ${copied ? "ti-check" : "ti-copy"}`} />
      <span className="max-w-[240px] truncate">{copied ? "Copied" : id}</span>
    </button>
  )
}

/** Copy the file's raw source text — the unrendered Markdown, not the preview. */
function CopyRaw({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title="Copy raw source"
      aria-label="Copy raw source"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
      className="flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-card px-2.5 py-1.5 text-meta text-ink-muted hover:bg-surface-control hover:text-ink-primary"
    >
      <i className={`shrink-0 text-[14px] ti ${copied ? "ti-check" : "ti-copy"}`} />
      <span>{copied ? "Copied" : "Copy raw"}</span>
    </button>
  )
}

/**
 * Put the file itself on the clipboard, so it pastes into another app as an
 * attachment rather than as text. Only the desktop shell can do this.
 */
function CopyAsFile({ name, text }: { name: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const [error, setError] = useState<string>()
  return (
    <button
      type="button"
      title={
        state === "failed" && error
          ? `Could not copy: ${error}`
          : "Copy as a file, to paste into another app"
      }
      aria-label="Copy as file"
      onClick={() =>
        void copyAsFile(name, text).then((result) => {
          setError(result.error)
          setState(result.ok ? "copied" : "failed")
          // A failure stays up longer, so its reason can be read on hover.
          setTimeout(() => setState("idle"), result.ok ? 1500 : 6000)
        })
      }
      className="flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-card px-2.5 py-1.5 text-meta text-ink-muted hover:bg-surface-control hover:text-ink-primary"
    >
      <i
        className={`shrink-0 text-[14px] ti ${
          state === "copied" ? "ti-check" : state === "failed" ? "ti-x" : "ti-file"
        }`}
      />
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Failed" : "Copy as file"}</span>
    </button>
  )
}

/**
 * The file as a `File` for the share sheet. Typed as plain text whatever its
 * extension: share targets (Chrome's especially) accept few types, and every
 * file this viewer shows is text.
 */
function shareableFile(name: string, text: string): File | undefined {
  if (typeof navigator === "undefined" || !navigator.canShare) return undefined
  const file = new File([text], name, { type: "text/plain" })
  return navigator.canShare({ files: [file] }) ? file : undefined
}

/**
 * Where "Copy as file" can't work — a browser, the mobile PWA — hand the file to
 * the OS share sheet instead, so it can still reach another app as a file.
 * Hidden where the browser can't share files.
 */
function ShareFile({ name, text }: { name: string; text: string }) {
  const [failed, setFailed] = useState(false)
  const file = shareableFile(name, text)
  if (!file) return null
  return (
    <button
      type="button"
      title="Share as a file, to send to another app"
      aria-label="Share file"
      onClick={() =>
        void navigator.share({ files: [file] }).catch((error: unknown) => {
          // Dismissing the sheet rejects too; that isn't a failure.
          if (error instanceof DOMException && error.name === "AbortError") return
          setFailed(true)
          setTimeout(() => setFailed(false), 1500)
        })
      }
      className="flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-card px-2.5 py-1.5 text-meta text-ink-muted hover:bg-surface-control hover:text-ink-primary"
    >
      <i className={`shrink-0 text-[14px] ti ${failed ? "ti-x" : "ti-share"}`} />
      <span>{failed ? "Failed" : "Share file"}</span>
    </button>
  )
}
