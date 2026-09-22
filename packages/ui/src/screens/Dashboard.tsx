import type { DashboardItemWithWidget, Widget as WidgetData } from "@staffroom/protocol"
import { observer } from "mobx-react-lite"
import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { DashboardGrid } from "../components/DashboardGrid.tsx"
import { api } from "../lib/api.ts"
import { useOperatorEvent, useStores } from "../stores/context.tsx"

/**
 * One dashboard: an editable grid of widgets referenced from any agent. The
 * operator adds widgets from a picker, drags and resizes them, renames the
 * dashboard, or deletes it. Layout is saved on each change; content is always
 * each widget's latest — loaded on open and refreshed live as agents update
 * their widgets.
 */
export const Dashboard = observer(function Dashboard() {
  const id = useParams().id ?? ""
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [items, setItems] = useState<DashboardItemWithWidget[]>([])
  const [loaded, setLoaded] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let live = true
    setLoaded(false)
    void api.dashboards
      .detail(id)
      .then((detail) => {
        if (!live) return
        setName(detail.dashboard.name)
        setItems(detail.items as DashboardItemWithWidget[])
      })
      .catch(() => {
        if (live) setItems([])
      })
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [id])

  // Live content: an agent wrote or removed a widget somewhere. Refetch the
  // dashboard and merge each item's latest widget content in by id, keeping the
  // current geometry so a refresh never disturbs an in-progress drag or resize.
  // A placement whose widget was deleted (cascade-removed) drops out.
  useOperatorEvent((event) => {
    if (event.type !== "widget.changed") return
    void api.dashboards
      .detail(id)
      .then((detail) => {
        const fresh = new Map(
          (detail.items as DashboardItemWithWidget[]).map((item) => [item.id, item]),
        )
        setItems((current) =>
          current
            .filter((item) => fresh.has(item.id))
            .map((item) => ({ ...item, widget: fresh.get(item.id)?.widget ?? item.widget })),
        )
      })
      .catch(() => undefined)
  })

  function saveLayout(next: DashboardItemWithWidget[]) {
    setItems(next)
    void api.dashboards
      .saveLayout(
        id,
        next.map((item) => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h })),
      )
      .catch(() => {
        // A failed save is not fatal — the next drag re-saves the whole layout.
      })
  }

  async function addWidget(widget: WidgetData) {
    setPicking(false)
    // Place it below everything, full-ish width.
    const y = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
    const box = { x: 0, y, w: 6, h: 4 }
    const item = await api.dashboards.addItem(id, { widgetId: widget.id, ...box }).catch(() => null)
    if (item) setItems((current) => [...current, { ...item, widget } as DashboardItemWithWidget])
  }

  async function removeItem(itemId: string) {
    setItems((current) => current.filter((item) => item.id !== itemId))
    await api.dashboards.removeItem(id, itemId).catch(() => undefined)
  }

  async function rename(next: string) {
    const trimmed = next.trim()
    setName(next)
    if (trimmed) await api.dashboards.rename(id, trimmed).catch(() => undefined)
  }

  async function remove() {
    await api.dashboards.remove(id).catch(() => undefined)
    navigate("/dashboards")
  }

  if (!loaded) return <div className="p-6 text-secondary text-ink-muted">Loading dashboard…</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line-default px-5 py-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={(event) => void rename(event.target.value)}
          aria-label="Dashboard name"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-ink-primary outline-none"
        />
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          className="flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-2.5 py-1.5 text-secondary text-ink-body hover:bg-surface-hover"
        >
          <i className="ti ti-plus text-[15px]" />
          Add widget
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          title="Delete dashboard"
          aria-label="Delete dashboard"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-status-failed"
        >
          <i className="ti ti-trash text-[17px]" />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto p-5">
        {picking && <WidgetPicker onPick={(widget) => void addWidget(widget)} />}
        {items.length === 0 ? (
          <div className="max-w-md text-secondary text-ink-muted">
            Empty dashboard. Use <strong>Add widget</strong> to place outputs from any agent, then
            drag and resize them.
          </div>
        ) : (
          <DashboardGrid
            items={items}
            onLayoutChange={saveLayout}
            onRemoveItem={(itemId) => void removeItem(itemId)}
          />
        )}
      </div>
    </div>
  )
})

/** A panel of every widget across the tenant's agents, to place on the grid. */
const WidgetPicker = observer(function WidgetPicker({
  onPick,
}: {
  onPick: (widget: WidgetData) => void
}) {
  const store = useStores()
  const [widgets, setWidgets] = useState<WidgetData[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    void api.widgets
      .list()
      .then((rows) => {
        if (live) setWidgets(rows as WidgetData[])
      })
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="mb-4 rounded-control border border-line-default bg-surface-card p-3">
      {!loaded ? (
        <div className="text-secondary text-ink-muted">Loading widgets…</div>
      ) : widgets.length === 0 ? (
        <div className="text-secondary text-ink-muted">
          No widgets yet. Agents create them with their <code>set_widget</code> tool.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {widgets.map((widget) => (
            <button
              key={widget.id}
              type="button"
              onClick={() => onPick(widget)}
              className="flex items-center gap-2 rounded-control border border-line-strong px-2.5 py-1.5 text-secondary text-ink-body hover:bg-surface-hover"
            >
              <span className="font-mono text-mono text-ink-faint">
                {store.roster.nameOf(widget.agentId)}
              </span>
              <span className="truncate">{widget.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
