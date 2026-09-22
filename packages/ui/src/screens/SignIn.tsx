import { type FormEvent, useState } from "react"
import { signIn, signUp } from "../lib/auth.ts"

/**
 * Sign in or create the first account. A small self-hosted team, so sign-up is
 * open and there is no email round trip — the first person to sign up is the
 * admin (the server's admin plugin promotes the first user).
 */
export function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const result =
      mode === "in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name || email })
    setBusy(false)
    if (result.error) setError(result.error.message ?? "Something went wrong.")
    // On success, useSession updates and App swaps to the shell.
  }

  return (
    <div className="flex h-full items-center justify-center bg-surface-canvas">
      <form
        onSubmit={submit}
        className="w-80 rounded-xl border border-line-default bg-surface-panel p-6 shadow-lg"
      >
        <h1 className="mb-1 text-lg font-semibold text-ink-primary">Staffroom</h1>
        <p className="mb-5 text-sm text-ink-muted">
          {mode === "in" ? "Sign in to your workspace." : "Create your account."}
        </p>

        {mode === "up" && (
          <Field label="Name">
            <input
              className={inputClass}
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
            />
          </Field>
        )}
        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            name="email"
            // `username` is the token password managers (1Password, Keychain)
            // key the login identifier off, even when it is an email.
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            name="password"
            // Signing in fills the saved password; signing up offers to save a
            // new one. Both cues a manager needs to do the right thing.
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </Field>

        {error && <p className="mb-3 text-sm text-status-failed">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-surface-control-hover py-2 text-sm font-medium text-ink-primary hover:bg-surface-control-active disabled:opacity-50"
        >
          {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "in" ? "up" : "in")}
          className="mt-3 w-full text-center text-xs text-ink-muted hover:text-ink-secondary"
        >
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  )
}

const inputClass =
  "w-full rounded-lg border border-line-default bg-surface-inset px-3 py-2 text-sm text-ink-body outline-none focus:border-line-strong"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  )
}
