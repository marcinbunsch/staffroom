import type { Widget as WidgetData } from "@staffroom/protocol"
import { observer } from "mobx-react-lite"
import { useEffect, useState } from "react"
import { Link, useParams } from "react-router"
import { Widget } from "../components/Widget.tsx"
import { api } from "../lib/api.ts"
import { useOperatorEvent, useStores } from "../stores/context.tsx"

/**
 * An agent's board: the widgets it maintains, rendered in a responsive grid.
 *
 * A widget is a snapshot from the agent's last run; the board loads it on open
 * and then refetches live whenever the agent writes or removes one of its
 * widgets (a `widget.changed` pulse). The operator can remove a widget; the
 * agent recreates it on its next run if it still produces it.
 */
export const Board = observer(function Board() {
  const agent = useParams().agentId ?? ""
  const store = useStores()
  const name = store.roster.nameOf(agent)
  const [widgets, setWidgets] = useState<WidgetData[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    setLoaded(false)
    void api.widgets
      .listForAgent(agent)
      .then((rows) => {
        if (live) setWidgets(rows as WidgetData[])
      })
      .catch(() => {
        // Keep an empty board rather than an error page; a refresh retries.
      })
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [agent])

  // Live refresh: this agent wrote or removed a widget. Refetch the whole board
  // — widgets keep their id across updates, so cards update in place.
  useOperatorEvent((event) => {
    if (event.type !== "widget.changed" || event.agent !== agent) return
    void api.widgets
      .listForAgent(agent)
      .then((rows) => setWidgets(rows as WidgetData[]))
      .catch(() => undefined)
  })

  async function remove(id: string) {
    // Optimistic: drop it locally, then delete. On failure, reload to be honest.
    setWidgets((current) => current.filter((widget) => widget.id !== id))
    try {
      await api.widgets.remove(id)
    } catch {
      const rows = await api.widgets.listForAgent(agent).catch(() => undefined)
      if (rows) setWidgets(rows as WidgetData[])
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line-default px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-ink-primary">{name}'s board</h1>
          <p className="text-xs text-ink-muted">
            Outputs {name} keeps current — updated on each run.
          </p>
        </div>
        <Link
          to={`/a/${agent}`}
          title="Back to chat"
          className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        >
          <i className="ti ti-message text-[17px]" />
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!loaded ? (
          <div className="text-secondary text-ink-muted">Loading board…</div>
        ) : widgets.length === 0 ? (
          <div className="max-w-md text-secondary text-ink-muted">
            No widgets yet. {name} produces widgets with its <code>set_widget</code> tool — ask it
            for a status readout or a chart, or set a schedule that keeps one current.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {widgets.map((widget) => (
              <Widget key={widget.id} widget={widget} onRemove={() => void remove(widget.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
