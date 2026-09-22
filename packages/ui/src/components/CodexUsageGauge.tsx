import type { CodexUsage, CodexUsageWindow } from "@staffroom/protocol"
import { observer } from "mobx-react-lite"
import { useEffect } from "react"
import { useStores } from "../stores/context.tsx"

/**
 * A small ring gauge of how much of the Codex plan is spent, for the composer
 * toolbar. It reads the shared {@link CodexUsageStore} — subscribing on mount so
 * the store's single poll runs while any gauge is on screen. Anything short of a
 * real snapshot — no Codex login, an unreachable endpoint, no primary window —
 * renders nothing, so the toolbar is unchanged wherever Codex is not in use.
 *
 * The ring tracks the primary ("5h") window, the one that bites first; a tooltip
 * on hover (or keyboard focus) names each limit, its spend, and the time left.
 */

export const CodexUsageGauge = observer(function CodexUsageGauge() {
  const { codexUsage } = useStores()
  useEffect(() => codexUsage.subscribe(), [codexUsage])

  const usage = codexUsage.usage
  if (!usage?.primary) return null
  const percent = Math.round(usage.primary.usedPercent)
  const tone =
    percent >= 90
      ? "text-status-failed"
      : percent >= 75
        ? "text-status-attention"
        : "text-status-working"

  return (
    <div className="group relative flex shrink-0 items-center">
      <div
        tabIndex={0}
        aria-label={`Codex usage ${percent}%`}
        className={`grid h-8 w-8 place-items-center rounded-control outline-none ${tone}`}
      >
        <Ring percent={percent} />
      </div>
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden w-max max-w-[240px] rounded-control border border-line-strong bg-surface-card px-2.5 py-2 text-meta text-ink-secondary group-hover:block group-focus-within:block"
      >
        {rows(usage).map((row) => (
          <div key={row.label} className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-ink-primary">{row.label}</span>
            <span className="ml-auto font-mono text-mono text-ink-faint">{row.percent}%</span>
            {row.timeLeft && (
              <span className="font-mono text-mono text-ink-faint">· {row.timeLeft} left</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

/** A 20px progress ring; the arc takes the container's text color. */
function Ring({ percent }: { percent: number }) {
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, percent)) / 100
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2.5"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - filled)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  )
}

interface Row {
  label: string
  percent: number
  timeLeft: string | null
}

/** One tooltip line per limit: its name, spend, and time left. */
function rows(usage: CodexUsage): Row[] {
  const list: Row[] = []
  if (usage.primary) list.push(rowOf("Rate limit", usage.primary))
  if (usage.secondary) list.push(rowOf("Weekly limit", usage.secondary))
  return list
}

function rowOf(fallback: string, window: CodexUsageWindow): Row {
  return {
    label: window.windowMinutes ? `${windowLabel(window.windowMinutes)} limit` : fallback,
    percent: Math.round(window.usedPercent),
    timeLeft: window.resetsAt ? timeLeft(window.resetsAt) : null,
  }
}

/** "5h" / "7d" style label from a window length in minutes. */
function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/** "Xd Yh Zm" until an epoch-seconds reset, dropping leading zero units. */
function timeLeft(epochSeconds: number): string {
  let seconds = Math.max(0, Math.round(epochSeconds - Date.now() / 1000))
  const days = Math.floor(seconds / 86_400)
  seconds -= days * 86_400
  const hours = Math.floor(seconds / 3600)
  seconds -= hours * 3600
  const minutes = Math.floor(seconds / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (days > 0 || hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(" ")
}
