/* Previous / Next paging, centred, with a "Page X of Y" between the two ends.
   The chevron sits on the leading edge — left for Previous, right for Next. A
   pager for a single page renders nothing; the caller need not guard. */

export interface PagerProps {
  /** Zero-based current page. */
  page: number
  /** Total number of pages; a pager for one page or fewer renders nothing. */
  pageCount: number
  /** Called with the page to move to, already clamped to range. */
  onPage: (page: number) => void
  /** Freezes both ends while a fetch is in flight. */
  busy?: boolean
}

export function Pager({ page, pageCount, onPage, busy = false }: PagerProps) {
  if (pageCount <= 1) return null
  const last = pageCount - 1
  return (
    <div className="flex items-center justify-center gap-4">
      <PagerButton
        label="Previous"
        icon="ti-chevron-left"
        disabled={busy || page <= 0}
        onClick={() => onPage(Math.max(0, page - 1))}
      />
      <span className="text-meta text-ink-muted">
        Page {page + 1} of {pageCount}
      </span>
      <PagerButton
        label="Next"
        icon="ti-chevron-right"
        iconAfter
        disabled={busy || page >= last}
        onClick={() => onPage(Math.min(last, page + 1))}
      />
    </div>
  )
}

function PagerButton({
  label,
  icon,
  iconAfter = false,
  disabled,
  onClick,
}: {
  label: string
  icon: string
  iconAfter?: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-control border border-line-strong bg-surface-card px-3 py-[7px] text-secondary text-ink-secondary hover:bg-surface-control disabled:opacity-50 disabled:hover:bg-surface-card"
    >
      {!iconAfter && <i className={`ti ${icon} text-[15px]`} />}
      {label}
      {iconAfter && <i className={`ti ${icon} text-[15px]`} />}
    </button>
  )
}
