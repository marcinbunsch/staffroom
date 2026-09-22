import { Link, useParams } from "react-router"
import { type Me } from "../../lib/api.ts"
import { AccountSection } from "./AccountSection.tsx"
import { ApiKeysSection } from "./ApiKeysSection.tsx"
import { DesignSystemSection } from "./DesignSystemSection.tsx"
import { IntegrationsSection } from "./integrations/index.tsx"
import { ModelCredentials } from "./ModelCredentials.tsx"
import { NotificationsSection } from "./NotificationsSection.tsx"
import { OperatorProfileSection } from "./OperatorProfileSection.tsx"
import { RolesSection } from "./RolesSection.tsx"
import { ShortcutsSection } from "./ShortcutsSection.tsx"
import { TeamsSection } from "./TeamsSection.tsx"
import { ToolsSection } from "./tools/index.tsx"

type SectionId =
  | "account"
  | "notifications"
  | "operator"
  | "keys"
  | "models"
  | "integrations"
  | "roles"
  | "teams"
  | "tools"
  | "shortcuts"
  | "design"

/**
 * Settings as a full page with its own section rail, ported from the prototype's
 * SettingsView. Each section is its own URL (`/settings/<id>`) so it is
 * linkable and survives a refresh. Roles and Teams are admin-only, and hidden on
 * a single-user server (the desktop app's local server), where nobody else exists.
 */
export function Settings({ me }: { me: Me }) {
  const isAdmin = me.role === "admin"
  // Drop admin-only entries (and multi-user ones on a single-user server) first,
  // then any group left empty by that filter, so no one sees a bare group header
  // with nothing under it.
  const groups = GROUPS.map((group) => ({
    ...group,
    sections: group.sections.filter(
      (entry) => (!entry.admin || isAdmin) && !(entry.multiUser && me.singleUser),
    ),
  })).filter((group) => group.sections.length > 0)
  const sections = groups.flatMap((group) => group.sections)
  const requested = useParams().section
  const section = sections.find((entry) => entry.id === requested)?.id ?? "account"

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[248px] flex-[0_0_248px] flex-col overflow-y-auto border-r border-line-strong bg-surface-rail px-4 py-6 sm:flex">
        <h1 className="px-2 text-lg font-semibold tracking-[-0.2px] text-ink-primary">Settings</h1>
        <div className="mt-6 flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              <div className="px-2.5 pb-1.5 font-mono text-label uppercase tracking-[0.7px] text-ink-label">
                {group.title}
              </div>
              {group.sections.map((entry) => (
                <Link
                  key={entry.id}
                  to={`/settings/${entry.id}`}
                  className={`flex items-center gap-2.5 rounded-control px-2.5 py-[9px] text-secondary ${
                    section === entry.id
                      ? "bg-surface-selected text-ink-primary"
                      : "bg-transparent text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                  }`}
                >
                  <i className={`ti ${entry.icon} w-[18px] text-center text-[16px] opacity-80`} />
                  <span>{entry.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-line-default px-4 py-3 sm:hidden">
          {groups.map((group, index) => (
            <div key={group.title} className="flex items-center gap-2">
              {index > 0 && <div className="h-6 w-px flex-none self-center bg-line-strong" />}
              {group.sections.map((entry) => (
                <Link
                  key={entry.id}
                  to={`/settings/${entry.id}`}
                  className={`flex-none rounded-full border px-3.5 py-2 text-secondary whitespace-nowrap ${
                    section === entry.id
                      ? "border-line-strong bg-surface-selected text-ink-primary"
                      : "border-line-strong bg-transparent text-ink-muted"
                  }`}
                >
                  {entry.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="max-w-2xl px-6 py-6">
          {section === "account" && <AccountSection me={me} />}
          {section === "notifications" && <NotificationsSection />}
          {section === "operator" && <OperatorProfileSection />}
          {section === "keys" && <ApiKeysSection />}
          {section === "models" && <ModelCredentials isAdmin={isAdmin} />}
          {section === "integrations" && <IntegrationsSection me={me} />}
          {section === "roles" && isAdmin && <RolesSection me={me} />}
          {section === "teams" && isAdmin && <TeamsSection />}
          {section === "tools" && <ToolsSection me={me} />}
          {section === "shortcuts" && <ShortcutsSection />}
          {section === "design" && <DesignSystemSection />}
        </div>
      </div>
    </div>
  )
}

type Section = { id: SectionId; label: string; icon: string; admin?: boolean; multiUser?: boolean }

/**
 * Sections grouped by concern, each group set off by its header and spacing in
 * the rail. A group whose every entry is admin-only simply disappears for
 * non-admins (handled in the component), so the headers never dangle.
 */
const GROUPS: { title: string; sections: Section[] }[] = [
  {
    title: "Personal",
    sections: [
      { id: "account", label: "Account", icon: "ti-user" },
      { id: "operator", label: "Operator profile", icon: "ti-id-badge-2" },
      { id: "notifications", label: "Notifications", icon: "ti-bell" },
      { id: "shortcuts", label: "Shortcuts", icon: "ti-keyboard" },
    ],
  },
  {
    title: "Connections",
    sections: [
      { id: "keys", label: "API keys", icon: "ti-key" },
      { id: "models", label: "Model credentials", icon: "ti-cpu" },
      { id: "integrations", label: "Integrations", icon: "ti-puzzle" },
      { id: "tools", label: "Toolsets", icon: "ti-plug" },
    ],
  },
  {
    title: "Workspace",
    sections: [
      { id: "roles", label: "Accounts & roles", icon: "ti-users", admin: true, multiUser: true },
      { id: "teams", label: "Teams", icon: "ti-users-group", admin: true, multiUser: true },
    ],
  },
  {
    title: "Advanced",
    sections: [{ id: "design", label: "Design system", icon: "ti-palette" }],
  },
]
