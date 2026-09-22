import { useEffect, useState } from "react"
import { useParams } from "react-router"
import { type FileRow, api } from "../lib/api.ts"
import { isMarkdownFile } from "../lib/files.ts"
import { Markdown } from "../components/Markdown.tsx"

/**
 * A standalone, chrome-free page that renders one artifact and nothing else, so
 * the browser's own "Save as PDF" (⌘P) produces a portable document with the
 * charts already baked in. The charts (Graphviz, Vega, Mermaid) render in the
 * browser exactly as they do in-app, so the PDF carries real vector diagrams —
 * no server render, no toolchain. This is why it lives outside the Shell.
 *
 * The page forces the light theme regardless of the app's setting: a dark PDF
 * wastes ink and print engines drop background fills by default, so light is the
 * only sensible paper. The theme is restored when the page unmounts.
 */

type Load =
  | { status: "loading" }
  | { status: "ready"; file: FileRow; text: string }
  | { status: "error"; message: string }

export function ArtifactPrint() {
  const { id } = useParams<{ id: string }>()
  const [load, setLoad] = useState<Load>({ status: "loading" })

  // Force light for the print surface; put the app's theme back on the way out.
  useEffect(() => {
    const previous = document.documentElement.dataset.theme
    document.documentElement.dataset.theme = "light"
    return () => {
      document.documentElement.dataset.theme = previous
    }
  }, [])

  useEffect(() => {
    if (!id) {
      setLoad({ status: "error", message: "No artifact id." })
      return
    }
    let live = true
    setLoad({ status: "loading" })
    Promise.all([api.files.get(id), api.files.text(id)]).then(
      ([file, text]) => live && setLoad({ status: "ready", file, text }),
      () => live && setLoad({ status: "error", message: "Could not load this artifact." }),
    )
    return () => {
      live = false
    }
  }, [id])

  // Name the tab (and so the suggested PDF filename) after the artifact.
  useEffect(() => {
    if (load.status !== "ready") return
    const previous = document.title
    document.title = load.file.name
    return () => {
      document.title = previous
    }
  }, [load])

  return (
    <div className="artifact-print min-h-screen bg-surface-canvas text-ink-primary">
      {/* The toolbar is screen-only: it must never appear in the printed page. */}
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 border-line-default border-b bg-surface-card px-4 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-mono text-ink-muted">
          {load.status === "ready" ? load.file.name : "Artifact"}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={load.status !== "ready"}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-card px-3 py-1.5 text-meta text-ink-secondary hover:bg-surface-control hover:text-ink-primary disabled:opacity-50"
        >
          <i className="ti ti-printer text-[15px]" />
          Save as PDF
        </button>
      </div>

      <div className="mx-auto w-full max-w-[760px] px-8 py-10">
        {load.status === "loading" && <div className="text-secondary text-ink-muted">Loading…</div>}
        {load.status === "error" && (
          <div className="text-secondary text-status-failed">{load.message}</div>
        )}
        {load.status === "ready" &&
          (isMarkdownFile(load.file) ? (
            <div className="markdown text-secondary [overflow-wrap:anywhere]">
              <Markdown>{load.text}</Markdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-mono text-ink-secondary">
              {load.text}
            </pre>
          ))}
      </div>
    </div>
  )
}
