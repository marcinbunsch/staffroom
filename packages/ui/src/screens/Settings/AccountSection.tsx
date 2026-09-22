import { type ReactNode, useState } from "react"
import { Button } from "../../design/index.ts"
import { type Me } from "../../lib/api.ts"
import { syncAppBadge } from "../../lib/app-badge.ts"
import { signOut } from "../../lib/auth.ts"
import { disablePush } from "../../lib/push.ts"
import { type ThemePreference, getThemePreference, setThemePreference } from "../../lib/theme.ts"

// Drop this device's push registration and clear the app badge before ending the
// session, so a shared browser stops receiving the signed-out account's
// notifications and shows no stale count. Best-effort — a failure here must never
// block signing out.
async function signOutAndUnregisterPush() {
  await disablePush().catch(() => {})
  syncAppBadge(0, 0)
  await signOut()
}

export function AccountSection({ me }: { me: Me }) {
  return (
    <section>
      <h2 className="text-heading font-semibold text-ink-primary">Account</h2>
      <p className="mt-1.5 text-secondary text-ink-meta">You, and how this session is signed in.</p>
      <div className="mt-6 flex flex-col gap-0.5">
        <Row
          title="Signed in as"
          description="Your account id — the tenant everything you own is scoped to."
        >
          <span className="font-mono text-mono text-ink-body">{me.tenantId}</span>
        </Row>
        <Row
          title="Role"
          description="Admin owns the shared surfaces — the org catalog, accounts, and skills."
        >
          <span className="rounded-chip border border-line-strong bg-line-subtle px-2 py-1 font-mono text-label uppercase text-ink-muted">
            {me.role}
          </span>
        </Row>
        <Row
          title="Appearance"
          description="Dark is the default. System follows your OS."
          last={me.singleUser}
        >
          <Appearance />
        </Row>
        {/* The desktop app signs its local server's one account in by itself, so
            there is no session to end. */}
        {!me.singleUser && (
          <Row title="Session" description="End this session on this device." last>
            <Button variant="danger" onClick={() => void signOutAndUnregisterPush()}>
              Sign out
            </Button>
          </Row>
        )}
      </div>
    </section>
  )
}

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "System" },
]

function Appearance() {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference)
  return (
    <div className="flex gap-1 rounded-[9px] border border-line-default bg-surface-card p-1">
      {THEMES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => {
            setThemePreference(entry.id)
            setTheme(entry.id)
          }}
          className={`cursor-pointer rounded-chip border-0 px-[13px] py-1.5 text-meta ${
            theme === entry.id
              ? "bg-surface-control text-ink-primary"
              : "bg-transparent text-ink-meta hover:text-ink-primary"
          }`}
        >
          {entry.label}
        </button>
      ))}
    </div>
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
