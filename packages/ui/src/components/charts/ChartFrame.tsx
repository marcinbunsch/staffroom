import { type ReactNode, useState } from "react"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../design/index.ts"

/**
 * The shared shell every chart sits in: a bordered card that matches the code
 * blocks it replaces, so a diagram and a fenced snippet read as siblings.
 *
 * Pass `expand` — an enlarged copy of the chart — to add a hover "view larger"
 * control that opens the chart in a near-full-viewport dialog for a closer look.
 */
export function ChartFrame({
  children,
  expand,
  label = "Chart",
  fill = false,
}: {
  children: ReactNode
  expand?: ReactNode
  label?: string
  /** Fill the parent's height as a flex column, so the chart grows to the box. */
  fill?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`chart-frame group relative overflow-x-auto rounded-control border border-line-default bg-surface-card p-3 ${
        fill ? "flex h-full flex-col" : "my-2"
      }`}
    >
      {children}
      {expand && (
        <>
          <button
            type="button"
            title="View larger"
            aria-label="View chart larger"
            onClick={() => setOpen(true)}
            // Always visible on touch (no hover to reveal it); on a real pointer
            // it stays quiet and appears on hover or keyboard focus.
            className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-control border border-line-default bg-surface-card text-ink-muted opacity-100 transition-opacity hover:bg-surface-hover hover:text-ink-primary pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
          >
            <i className="ti ti-arrows-maximize text-[15px]" />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent size="full">
              <DialogHeader>
                <DialogTitle srOnly>{label}</DialogTitle>
                <span className="flex-1" />
                <DialogClose
                  aria-label="Close"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                >
                  <i className="ti ti-x text-[16px]" />
                </DialogClose>
              </DialogHeader>
              {/* Radix mounts this only while open, so the enlarged chart embeds
                  fresh each time and tears down on close. */}
              <DialogBody className="grid min-h-0 place-items-center p-4">{expand}</DialogBody>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}

export function ChartLoading() {
  return (
    <ChartFrame>
      <div className="py-6 text-center text-mono text-ink-muted">Rendering chart…</div>
    </ChartFrame>
  )
}

/**
 * A spec that will not parse falls back to its raw source — the same plain code
 * block react-markdown would have shown — plus a quiet note naming the kind, so
 * a malformed chart never blanks out or crashes the surrounding message.
 */
export function ChartError({ source, label }: { source: string; label: string }) {
  return (
    <div className="my-2 rounded-control border border-line-failed bg-surface-card">
      <div className="border-line-subtle border-b px-3 py-1.5 text-mono text-status-failed">
        Could not render {label} chart
      </div>
      <pre className="overflow-x-auto p-3">
        <code>{source}</code>
      </pre>
    </div>
  )
}
