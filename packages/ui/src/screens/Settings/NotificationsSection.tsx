import { type ReactNode, useEffect, useState } from "react"
import { Button } from "../../design/index.ts"
import {
  disablePush,
  enablePush,
  type PushState,
  pushAvailable,
  pushState,
} from "../../lib/push.ts"

/**
 * Turn browser/PWA push notifications on for this device. One toggle: it drives
 * the whole permission + service-worker + subscribe flow (see `lib/push.ts`),
 * and registers the subscription with the server so agent escalations reach this
 * browser even when the tab is closed. Hidden entirely when the browser can't do
 * push or the server has no VAPID keys configured.
 */
export function NotificationsSection() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [state, setState] = useState<PushState>("disabled")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const [isAvailable, current] = await Promise.all([pushAvailable(), pushState()])
      if (!live) return
      setAvailable(isAvailable)
      setState(current)
    })()
    return () => {
      live = false
    }
  }, [])

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      if (state === "enabled") await disablePush()
      else await enablePush()
      setState(await pushState())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.")
      setState(await pushState())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Notifications</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">
        Get a notification when an agent needs you — a question, a decision, or an approval — even
        when Staffroom is closed.
      </p>
      <div className="mt-6 flex flex-col gap-0.5">
        <Row
          title="Push on this device"
          description="Each browser or device you use is enabled separately."
          last
        >
          {available === null ? (
            <span className="text-meta text-ink-faint">Checking…</span>
          ) : !available ? (
            <span className="text-meta text-ink-faint">
              Not available on this browser or server.
            </span>
          ) : state === "denied" ? (
            <span className="text-meta text-ink-faint">
              Blocked — allow notifications in your browser settings.
            </span>
          ) : (
            <Button
              variant={state === "enabled" ? "danger" : "primary"}
              onClick={toggle}
              disabled={busy}
            >
              {busy ? "Working…" : state === "enabled" ? "Disable" : "Enable"}
            </Button>
          )}
        </Row>
        {error && <p className="px-1 pt-2 text-meta text-status-failed">{error}</p>}
      </div>
    </section>
  )
}

function Row({
  title,
  description,
  children,
  last = false,
}: {
  title: string
  description: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 px-1 py-4 ${
        last ? "" : "border-b border-line-subtle"
      }`}
    >
      <div className="min-w-0 flex-[1_1_300px]">
        <div className="text-secondary font-medium text-ink-body">{title}</div>
        <div className="mt-1 text-meta text-ink-faint">{description}</div>
      </div>
      {children}
    </div>
  )
}
