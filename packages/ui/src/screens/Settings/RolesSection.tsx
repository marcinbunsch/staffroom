import { useCallback, useEffect, useState } from "react"
import { Button } from "../../design/index.ts"
import { type Me } from "../../lib/api.ts"
import { auth } from "../../lib/auth.ts"
import { type AdminUser, errorText, field } from "./common.tsx"

// ── Accounts & roles ─────────────────────────────────────────────────────────

export function RolesSection({ me }: { me: Me }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [error, setError] = useState<string>()
  const [adding, setAdding] = useState(false)

  const reload = useCallback(() => {
    setError(undefined)
    auth.admin.listUsers({ query: { limit: 200 } }).then(
      (result) =>
        setUsers(((result.data as { users?: AdminUser[] } | null)?.users ?? []) as AdminUser[]),
      () => setError("Could not load accounts."),
    )
  }, [])
  useEffect(() => reload(), [reload])

  async function run(work: () => Promise<{ error?: unknown }>) {
    setError(undefined)
    const result = await work()
    if (result.error) {
      setError(errorText(result.error))
      return
    }
    reload()
  }

  return (
    <section>
      <div className="flex items-center">
        <div>
          <h2 className="text-heading font-semibold text-ink-primary">Accounts &amp; roles</h2>
          <p className="mt-1.5 text-secondary text-ink-meta">
            Everyone who can sign in, and what they own. An admin owns the shared surfaces.
          </p>
        </div>
        <Button variant="secondary" className="ml-auto" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "New account"}
        </Button>
      </div>

      {error && <p className="mt-4 text-secondary text-status-failed">{error}</p>}

      {adding && (
        <NewAccount
          onCreated={() => {
            setAdding(false)
            reload()
          }}
          onError={setError}
        />
      )}

      <div className="mt-5 flex flex-col gap-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex flex-wrap items-center gap-3 rounded-card border border-line-default bg-surface-card px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-secondary text-ink-body">
                {user.name ? `${user.name} · ` : ""}
                {user.email}
                {user.id === me.tenantId && (
                  <span className="ml-2 text-meta text-ink-faint">(you)</span>
                )}
              </div>
            </div>
            <select
              value={user.role ?? "user"}
              disabled={user.id === me.tenantId}
              onChange={(event) =>
                void run(() =>
                  auth.admin.setRole({
                    userId: user.id,
                    role: event.target.value as "admin" | "user",
                  }),
                )
              }
              className="rounded-control border border-line-strong bg-surface-inset px-2 py-1.5 text-secondary text-ink-body disabled:opacity-50"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            {user.id !== me.tenantId && (
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm(`Remove ${user.email}? Everything they own goes with them.`))
                    void run(() => auth.admin.removeUser({ userId: user.id }))
                }}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function NewAccount({
  onCreated,
  onError,
}: {
  onCreated: () => void
  onError: (message: string) => void
}) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!email.trim() || !password) return
    setBusy(true)
    const result = await auth.admin.createUser({
      email: email.trim(),
      password,
      name: name.trim() || email.split("@")[0] || email,
      role,
    })
    setBusy(false)
    if (result.error) {
      onError(errorText(result.error))
      return
    }
    onCreated()
  }

  return (
    <div className="mt-4 flex flex-col gap-2 rounded-card border border-line-default bg-surface-card p-4">
      <div className="flex flex-wrap gap-2">
        <input
          className={`${field} flex-1`}
          placeholder="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className={`${field} flex-1`}
          placeholder="name (optional)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className={`${field} flex-1`}
          type="password"
          placeholder="temporary password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <select
          className={field}
          value={role}
          onChange={(event) => setRole(event.target.value as "user" | "admin")}
        >
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <Button variant="primary" disabled={busy || !email || !password} onClick={create}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </div>
  )
}
