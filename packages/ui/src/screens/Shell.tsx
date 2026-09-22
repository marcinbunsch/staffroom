import classNames from "classnames"
import { observer } from "mobx-react-lite"
import { Suspense, lazy, useEffect, useState } from "react"
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router"
import logoUrl from "../assets/logo-transparent.png"
import { CommandPalette } from "../components/CommandPalette.tsx"
import { Avatar, StatusDot, UnreadBadge } from "../design/index.ts"
import { type Me, type StaffRow } from "../lib/api.ts"
import { initials } from "../lib/format.ts"
import { useNotificationRouting } from "../lib/notification-routing.ts"
import { useShortcuts } from "../lib/use-shortcuts.ts"
import { presenceStatus } from "../lib/status.ts"
import { isDesktopShell } from "../lib/use-desktop.ts"
import { useStores } from "../stores/context.tsx"
import { currentTheme, setThemePreference } from "../lib/theme.ts"

// Screens are lazily imported so each becomes its own chunk, loaded on
// navigation rather than bundled into the eager entry. `lazy` needs a default
// export, so each loader re-maps the screen's named export.
const Board = lazy(() => import("./Board.tsx").then((m) => ({ default: m.Board })))
const Chat = lazy(() => import("./Chat.tsx").then((m) => ({ default: m.Chat })))
const Dashboards = lazy(() => import("./Dashboards.tsx").then((m) => ({ default: m.Dashboards })))
const Dashboard = lazy(() => import("./Dashboard.tsx").then((m) => ({ default: m.Dashboard })))
const EditAgent = lazy(() => import("./EditAgent.tsx").then((m) => ({ default: m.EditAgent })))
const Files = lazy(() => import("./Files.tsx").then((m) => ({ default: m.Files })))
const Home = lazy(() => import("./Home.tsx").then((m) => ({ default: m.Home })))
const Job = lazy(() => import("./Job.tsx").then((m) => ({ default: m.Job })))
const Jobs = lazy(() => import("./Jobs.tsx").then((m) => ({ default: m.Jobs })))
const Memory = lazy(() => import("./Memory.tsx").then((m) => ({ default: m.Memory })))
const NewAgent = lazy(() => import("./NewAgent.tsx").then((m) => ({ default: m.NewAgent })))
const NewSchedule = lazy(() =>
  import("./NewSchedule.tsx").then((m) => ({ default: m.NewSchedule })),
)
const Schedule = lazy(() => import("./Schedule.tsx").then((m) => ({ default: m.Schedule })))
const Schedules = lazy(() => import("./Schedules.tsx").then((m) => ({ default: m.Schedules })))
const Settings = lazy(() => import("./Settings/index.tsx").then((m) => ({ default: m.Settings })))
const Skills = lazy(() => import("./Skills.tsx").then((m) => ({ default: m.Skills })))
const Spend = lazy(() => import("./Spend.tsx").then((m) => ({ default: m.Spend })))

const TERMINAL_JOB_STATES = new Set(["done", "failed", "cancelled"])

/**
 * The app shell: a rail of the roster and the main views, a main pane routed by
 * URL. The roster is loaded here and passed down; a chat is `/a/<agentId>`.
 * Creating an agent or connecting a credential is done in-app (Settings and New
 * agent), so a fresh sign-in reaches a working chat without any script.
 */
export const Shell = observer(function Shell({ me }: { me: Me }) {
  // Roster and per-agent unread all come from the data
  // layer now — loaded once and kept fresh by the operator stream, not a timer.
  const store = useStores()
  const roster = store.roster.members
  // Mirror the board's "Working now" definition: assigned, working, and jobs
  // waiting on children are all still live work; paused and terminal jobs are not.
  const activeJobCount = store.jobs.jobs.filter(
    (job) => !TERMINAL_JOB_STATES.has(job.state) && job.state !== "paused",
  ).length
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Close the mobile drawer whenever the route changes, so a tap that navigates
  // (or a redirect) never leaves it hanging open over the new view.
  const location = useLocation()
  useEffect(() => setDrawerOpen(false), [location.pathname])
  // A tapped push notification routes to the agent's chat.
  useNotificationRouting()
  // Global keyboard shortcuts: cycle agents and an agent's chats.
  useShortcuts()
  const reloadRoster = () => void store.roster.load()
  const onDesktop = isDesktopShell()

  return (
    <div className="flex h-full overflow-hidden bg-surface-canvas text-ink-primary">
      {/* The ⌘K command palette overlays any screen; mounted once, opened via the
          shortcut store. */}
      <CommandPalette />
      {/* Desktop: the rail is a fixed left column. Inside the Electron shell the
          frameless window's traffic lights overlay the top-left, so reserve a
          draggable strip that both clears them and lets the window be dragged. */}
      <aside
        className={classNames(
          "hidden w-[248px] flex-[0_0_248px] flex-col border-r border-line-default bg-surface-rail px-3.5 pb-2 desktop:flex",
          { "pt-2": onDesktop, "pt-[22px]": !onDesktop },
        )}
      >
        {onDesktop && <div className="app-drag -mx-3.5 h-[34px] shrink-0" />}
        <RailContent roster={roster} activeJobCount={activeJobCount} />
      </aside>

      {/* Mobile: the same rail behind a menu button, as a slide-in drawer. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-30 desktop:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/45" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[284px] max-w-[85vw] flex-col border-r border-line-default bg-surface-rail px-3.5 pt-[calc(22px_+_env(safe-area-inset-top))] pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
            <RailContent
              roster={roster}
              activeJobCount={activeJobCount}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar with the menu button. Hidden on desktop. */}
        <div className="flex items-center gap-2 border-b border-line-default bg-surface-canvas px-3 pt-[env(safe-area-inset-top)] pb-3 desktop:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-control text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
          >
            <i className="ti ti-menu-2 text-[19px]" />
          </button>
          <img src={logoUrl} alt="" className="block h-[26px] w-[26px] object-contain" />
          <div className="text-subheading font-semibold tracking-[0.2px] text-ink-primary">
            Staffroom
          </div>
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-canvas">
          <Suspense fallback={<ScreenFallback />}>
            <Routes>
              <Route path="/dashboards" element={<Dashboards />} />
              <Route path="/dashboards/:id" element={<Dashboard />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<Job me={me} />} />
              <Route path="/schedules" element={<Schedules />} />
              <Route path="/schedules/new" element={<NewSchedule roster={roster} />} />
              <Route path="/schedules/:id" element={<Schedule />} />
              <Route path="/files" element={<Files roster={roster} />} />
              <Route path="/memory" element={<Memory roster={roster} />} />
              <Route path="/skills" element={<Skills me={me} roster={roster} />} />
              <Route path="/spend" element={<Spend me={me} roster={roster} />} />
              <Route path="/settings" element={<Navigate to="/settings/account" replace />} />
              <Route path="/settings/:section" element={<Settings me={me} />} />
              <Route path="/new-agent" element={<NewAgent onCreated={reloadRoster} />} />
              <Route
                path="/a/:agentId/edit"
                element={<EditAgent roster={roster} onChanged={reloadRoster} />}
              />
              <Route path="/a/:agentId/board" element={<Board />} />
              <Route path="/a/:agentId" element={<Chat />} />
              <Route path="/a/:agentId/c/:chatId" element={<Chat />} />
              <Route path="/" element={roster[0] ? <Home /> : <Welcome />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
})

/** The rail's contents, shared by the desktop aside and the mobile drawer. */
function RailContent({
  roster,
  activeJobCount,
  onNavigate,
}: {
  roster: StaffRow[]
  activeJobCount: number
  onNavigate?: () => void
}) {
  return (
    <>
      <div className="flex items-center gap-2.5 px-2 pb-[22px] ">
        <img src={logoUrl} alt="" className="-my-0.5 block h-[30px] w-[30px] object-contain" />
        <div className="text-heading font-semibold tracking-[0.2px] text-ink-primary">
          Staffroom
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <RailNavItem
            key={item.to}
            to={item.to}
            label={item.label}
            icon={item.icon}
            end={item.to === "/"}
            activeBadge={item.to === "/jobs" ? activeJobCount : undefined}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-[26px] mb-2 flex items-center px-2.5">
        <span className="font-mono text-label uppercase tracking-[0.7px] text-ink-label">
          The staff
        </span>
        <Link
          to="/new-agent"
          onClick={onNavigate}
          title="Add an agent"
          className="ml-auto text-ink-muted hover:text-ink-primary"
        >
          <i className="ti ti-plus text-[15px]" />
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto">
        {roster.length === 0 && (
          <Link
            to="/new-agent"
            onClick={onNavigate}
            className="px-2.5 py-2 text-secondary text-ink-muted hover:text-ink-primary"
          >
            No staff yet — add one.
          </Link>
        )}
        {roster.map((member) => (
          <RailRosterItem key={member.id} member={member} onNavigate={onNavigate} />
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line-subtle pt-4">
        <NavLink
          to="/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex flex-1 items-center gap-2.5 rounded-control px-2.5 py-[7px] text-secondary ${
              isActive
                ? "bg-surface-selected text-ink-primary"
                : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
            }`
          }
        >
          <i className="ti ti-settings w-[18px] text-center text-[17px] opacity-80" />
          <span>Settings</span>
        </NavLink>
        <ThemeToggle />
      </div>
    </>
  )
}

/**
 * One roster member in the rail, ported from the prototype: a live status dot
 * (working / needs-you / failed / idle), an unread badge, and a name that goes
 * bold when unread. All of it reads one `presence` overview, refreshed off the
 * operator stream, so the three cues never disagree.
 */
const RailRosterItem = observer(function RailRosterItem({
  member,
  onNavigate,
}: {
  member: StaffRow
  onNavigate?: () => void
}) {
  const { presence } = useStores()
  const overview = presence.overviewFor(member.id)
  const status = presenceStatus(overview?.activity ?? "idle")
  const idle = status === "idle"
  const unread = overview?.unreadCount ?? 0
  const nameClass = unread
    ? "font-semibold text-ink-primary"
    : idle
      ? "text-ink-muted"
      : "font-medium text-ink-primary"
  return (
    <NavLink
      to={`/a/${member.id}`}
      onClick={onNavigate}
      title={overview?.label ?? "Idle"}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-control px-2.5 py-[7px] text-secondary ${
          isActive ? "bg-surface-selected" : "hover:bg-surface-hover"
        }`
      }
    >
      <Avatar initials={initials(member.name)} size="sm" idle={idle} />
      <span className={`min-w-0 flex-1 truncate ${nameClass}`}>{member.name}</span>
      <span className="flex flex-none items-center gap-[7px]">
        <UnreadBadge count={unread} />
        <StatusDot status={status} ring />
      </span>
    </NavLink>
  )
})

const NAV: { to: string; label: string; icon: string }[] = [
  { to: "/", label: "Home", icon: "ti-home" },
  { to: "/dashboards", label: "Dashboards", icon: "ti-layout-dashboard" },
  { to: "/jobs", label: "Jobs", icon: "ti-checklist" },
  { to: "/schedules", label: "Schedules", icon: "ti-clock" },
  { to: "/files", label: "Files", icon: "ti-files" },
  { to: "/memory", label: "Memory", icon: "ti-brain" },
  { to: "/skills", label: "Skills", icon: "ti-sparkles" },
  { to: "/spend", label: "Spend", icon: "ti-coin" },
]

function RailNavItem({
  to,
  label,
  icon,
  end,
  activeBadge,
  onNavigate,
}: {
  to: string
  label: string
  icon: string
  /** Match this route exactly — for "/" so Home isn't active on every page. */
  end?: boolean
  activeBadge?: number
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={activeBadge ? `${activeBadge} active job${activeBadge === 1 ? "" : "s"}` : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-control px-2.5 py-2 font-medium text-secondary ${
          isActive
            ? "bg-surface-selected text-ink-primary"
            : "text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        }`
      }
    >
      <i className={`ti ${icon} w-[18px] text-center text-[17px] opacity-80`} />
      <span className="flex-1">{label}</span>
      {activeBadge !== undefined && activeBadge > 0 && <NavBadge count={activeBadge} active />}
    </NavLink>
  )
}

function NavBadge({ count, active = false }: { count: number; active?: boolean }) {
  return (
    <span className="flex items-center gap-1 font-mono text-mono font-semibold text-status-working">
      {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-working" />}
      {count}
    </span>
  )
}

/** A quick light/dark flip. "system" resolves off the DOM's painted theme. */
function ThemeToggle() {
  const [, force] = useState(0)
  return (
    <button
      type="button"
      title="Toggle theme"
      aria-label="Toggle light/dark theme"
      onClick={() => {
        setThemePreference(currentTheme() === "light" ? "dark" : "light")
        force((n) => n + 1)
      }}
      className="grid h-[30px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-control border border-line-strong bg-transparent text-ink-muted hover:text-ink-primary"
    >
      <i className="ti ti-contrast text-[15px]" />
    </button>
  )
}

/** Shown while a lazily-loaded screen's chunk is in flight. */
function ScreenFallback() {
  return <div className="flex h-full items-center justify-center text-ink-muted">Loading…</div>
}

/** First-run: no staff yet. Point at the two things onboarding needs. */
function Welcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-ink-secondary">Welcome to Staffroom.</p>
      <p className="max-w-sm text-sm text-ink-muted">
        Connect a model credential in{" "}
        <Link to="/settings" className="text-ink-body underline">
          Settings
        </Link>
        , then{" "}
        <Link to="/new-agent" className="text-ink-body underline">
          add an agent
        </Link>{" "}
        to start chatting.
      </p>
    </div>
  )
}
