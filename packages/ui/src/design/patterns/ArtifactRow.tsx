import type { ReactNode } from "react"

/* File/artifact rows: a three-letter mono type badge, name, meta, and a set of
   trailing actions. Ported from the prototype; the share toggle is a v2 addition
   for a file's org/private visibility. */

export interface ArtifactRowProps {
  /** Three-letter mono type badge: DIF, LOG, MD, TXT, PDF. */
  type: string
  name: ReactNode
  meta?: ReactNode
  /** working tints the meta line blue for in-progress drafts. */
  metaTone?: "faint" | "working"
  onClick?: () => void
  /** A trailing eye button that reads the file into a preview. */
  onView?: () => void
  /** A trailing download button that saves the file to disk. */
  onDownload?: () => void
  /** A trailing share toggle. `shared` picks the icon (unlink vs share). */
  onShare?: () => void
  shared?: boolean
  /** Topics on the file, shown as chips under the meta line. */
  labels?: string[]
  /** A trailing tag button that opens a label editor. */
  onEditLabels?: () => void
  /** A trailing delete button that removes the file for good. */
  onDelete?: () => void
}

export function ArtifactRow({
  type,
  name,
  meta,
  metaTone = "faint",
  onClick,
  onView,
  onDownload,
  onShare,
  shared = false,
  labels,
  onEditLabels,
  onDelete,
}: ArtifactRowProps) {
  const label = typeof name === "string" ? name : undefined
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-[11px] rounded-row border border-line-inset bg-surface-card-hover px-3 py-[11px] ${
        onClick ? "cursor-pointer" : ""
      }`}
    >
      <div className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-monogram bg-surface-control font-mono text-[9px] text-ink-monogram">
        {type}
      </div>
      <div className="min-w-0 flex-1 text-secondary">
        <div className="truncate" title={label}>
          {name}
        </div>
        <div
          className={`mt-0.5 font-mono text-mono ${
            metaTone === "working" ? "text-status-working" : "text-ink-faint"
          }`}
        >
          {meta}
        </div>
        {labels && labels.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {labels.map((tag) => (
              <span
                key={tag}
                className="rounded-[5px] border border-line-strong bg-line-subtle px-[6px] py-[2px] font-mono text-label text-ink-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {onEditLabels && <Action icon="ti-tag" title="Labels" onClick={onEditLabels} label={label} />}
      {onView && <Action icon="ti-eye" title="View" onClick={onView} label={label} />}
      {onDownload && (
        <Action icon="ti-download" title="Download" onClick={onDownload} label={label} />
      )}
      {onShare && (
        <Action
          icon={shared ? "ti-lock-open" : "ti-share"}
          title={shared ? "Make private" : "Share with the org"}
          onClick={onShare}
          label={label}
          tone={shared ? "shared" : undefined}
        />
      )}
      {onDelete && (
        <Action icon="ti-trash" title="Delete" onClick={onDelete} label={label} tone="danger" />
      )}
    </div>
  )
}

function Action({
  icon,
  title,
  onClick,
  label,
  tone,
}: {
  icon: string
  title: string
  onClick: () => void
  label?: string
  tone?: "danger" | "shared"
}) {
  const hover =
    tone === "danger"
      ? "hover:bg-surface-hover hover:text-status-failed"
      : "hover:bg-surface-hover hover:text-ink-primary"
  const base = tone === "shared" ? "text-status-done" : "text-ink-muted"
  return (
    <button
      type="button"
      aria-label={label ? `${title} ${label}` : title}
      title={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-control border-0 bg-transparent ${base} ${hover}`}
    >
      <i className={`ti ${icon} text-[16px]`} />
    </button>
  )
}
