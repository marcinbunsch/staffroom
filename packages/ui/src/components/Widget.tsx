import type { Widget as WidgetData } from "@staffroom/protocol"
import { timeAgo } from "../lib/format.ts"
import { Markdown } from "./Markdown.tsx"
import { ChartError } from "./charts/ChartFrame.tsx"
import { VegaChart } from "./charts/VegaChart.tsx"

/**
 * One widget on a board or dashboard: a titled card whose body is Markdown or a
 * Vega-Lite chart, per its `type`. The card shows when the agent last refreshed
 * it — a widget is a snapshot of what the agent knew then, so the age matters.
 *
 * A malformed Vega-Lite spec falls back to its raw source (as a bad fence does
 * in chat) rather than blanking the card.
 *
 * `fill` makes the card fill its parent's height and lets a chart grow to the
 * box — for a dashboard tile the operator resizes. Off elsewhere (a board card,
 * a chat message), where the card is sized by its content.
 */
export function Widget({
  widget,
  onRemove,
  fill = false,
}: {
  widget: WidgetData
  onRemove?: () => void
  fill?: boolean
}) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-control border border-line-default bg-surface-card ${
        fill ? "h-full" : ""
      }`}
    >
      <header className="flex items-center gap-2 border-b border-line-subtle px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-primary">
          {widget.title}
        </h2>
        <span className="shrink-0 text-mono text-ink-faint" title={widget.updatedAt}>
          {timeAgo(widget.updatedAt)}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove widget"
            aria-label="Remove widget"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-control text-ink-faint hover:bg-surface-hover hover:text-status-failed"
          >
            <i className="ti ti-trash text-[15px]" />
          </button>
        )}
      </header>
      <div className={`min-w-0 overflow-x-auto p-3 ${fill ? "min-h-0 flex-1" : ""}`}>
        <WidgetBody widget={widget} fill={fill} />
      </div>
    </section>
  )
}

function WidgetBody({ widget, fill }: { widget: WidgetData; fill: boolean }) {
  if (widget.type === "vega-lite") {
    // Guard the JSON here so a bad spec shows its source rather than a blank
    // frame; VegaChart also guards, but this keeps the fallback consistent.
    try {
      JSON.parse(widget.content)
    } catch {
      return <ChartError source={widget.content} label="vega-lite" />
    }
    return <VegaChart source={widget.content} fill={fill} />
  }
  return <Markdown>{widget.content}</Markdown>
}
