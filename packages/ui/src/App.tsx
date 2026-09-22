import { Suspense, lazy, useEffect, useState } from "react"
import { Navigate, Route, Routes } from "react-router"
import { type Me, api } from "./lib/api.ts"
import { useSession } from "./lib/auth.ts"
import { isLocalServerShell, requestLocalSignIn } from "./lib/use-desktop.ts"
import { StoreProvider } from "./stores/context.tsx"
import { SignIn } from "./screens/SignIn.tsx"
import { Shell } from "./screens/Shell.tsx"

// The design-system doc is only reached at /design; keep it out of the entry.
const DesignSystemView = lazy(() =>
  import("./screens/DesignSystemView.tsx").then((m) => ({ default: m.DesignSystemView })),
)

// The chrome-free print view (for browser "Save as PDF") is a rare path; lazy it.
const ArtifactPrint = lazy(() =>
  import("./screens/ArtifactPrint.tsx").then((m) => ({ default: m.ArtifactPrint })),
)

/**
 * The app root: an auth gate, then the shell.
 *
 * better-auth's `useSession` is the source of truth for "am I signed in". Once
 * signed in, one `/api/me` fetch gets the tenant id — the UI needs it to compose
 * an agent's session key — and everything below the shell reads it from context.
 */
export function App() {
  const { data: session, isPending } = useSession()

  if (isPending) return <Splash />
  if (!session) return isLocalServerShell() ? <LocalSignIn /> : <SignIn />
  return <Authenticated />
}

function Authenticated() {
  const [me, setMe] = useState<Me | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api.me().then(setMe, () => setFailed(true))
  }, [])

  if (failed) return <Splash message="Could not reach the server." />
  if (!me) return <Splash />

  return (
    <StoreProvider>
      <Suspense fallback={<Splash />}>
        <Routes>
          {/* Full-page: the design system doc has its own chrome, so it sits
              outside the shell rather than inside the main pane. */}
          <Route path="/design" element={<DesignSystemView />} />
          {/* Chrome-free single artifact, for the browser's "Save as PDF". */}
          <Route path="/print/:id" element={<ArtifactPrint />} />
          <Route path="/*" element={<Shell me={me} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </StoreProvider>
  )
}

/**
 * The desktop app's local account has no sign-in form: its window opens signed
 * in. If that session is gone (expired, or cleared), ask the app to sign in again
 * rather than show a form with no password-holding account behind it.
 */
function LocalSignIn() {
  useEffect(() => requestLocalSignIn(), [])
  return <Splash message="Signing in…" />
}

function Splash({ message }: { message?: string }) {
  return (
    <div className="flex h-full items-center justify-center text-ink-muted">
      {message ?? "Loading…"}
    </div>
  )
}
