import type { Dashboard } from "@staffroom/protocol"
import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { api } from "../lib/api.ts"
import { timeAgo } from "../lib/format.ts"

/**
 * The dashboards index: every dashboard the tenant has built, and a button to
 * create one. A dashboard is a curated grid of widgets from any agent — the one
 * place to watch the status of everything at once.
 */
export function Dashboards() {
  const navigate = useNavigate()
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let live = true
    void api.dashboards
      .list()
      .then((rows) => {
        if (live) setDashboards(rows as Dashboard[])
      })
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [])

  async function create() {
    if (creating) return
    setCreating(true)
    try {
      const dashboard = await api.dashboards.create("Untitled dashboard")
      navigate(`/dashboards/${dashboard.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line-default px-5 py-3">
        <h1 className="flex-1 text-sm font-semibold text-ink-primary">Dashboards</h1>
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="flex shrink-0 items-center gap-1.5 rounded-control border border-line-strong px-2.5 py-1.5 text-secondary text-ink-body hover:bg-surface-hover disabled:opacity-50"
        >
          <i className="ti ti-plus text-[15px]" />
          New dashboard
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {!loaded ? (
          <div className="text-secondary text-ink-muted">Loading dashboards…</div>
        ) : dashboards.length === 0 ? (
          <div className="max-w-md text-secondary text-ink-muted">
            No dashboards yet. Create one to pull together widgets from any of your agents into a
            single grid you can watch.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {dashboards.map((dashboard) => (
              <Link
                key={dashboard.id}
                to={`/dashboards/${dashboard.id}`}
                className="flex flex-col gap-1 rounded-control border border-line-default bg-surface-card p-4 hover:bg-surface-hover"
              >
                <span className="truncate text-sm font-semibold text-ink-primary">
                  {dashboard.name}
                </span>
                <span className="text-mono text-ink-faint">
                  Updated {timeAgo(dashboard.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
