import { join } from "node:path"
import { apiKey } from "@better-auth/api-key"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { admin } from "better-auth/plugins"
import { anyAccountExists } from "./accounts.ts"
import { STAFFROOM_HOME, resolveAuthSecret } from "./config.ts"
import { localSignIn } from "./local-sign-in.ts"
import { openConnection } from "../coordinator/database.ts"
import { getTeamStore } from "../coordinator/teams.ts"

/**
 * Accounts, sessions and roles.
 *
 * A tenant *is* a better-auth user: `tenant_id` everywhere in this codebase is
 * a user id from these tables. That is why auth lives in the same
 * `staffroom.db` as the operational stores — the thing every other row points
 * at should not be in a different file from the rows that point at it.
 *
 * It gets its **own connection** to that file, though. better-auth drives
 * Kysely, which runs its own migrations and its own transactions; handing it
 * the connection that every synchronous store call shares would put schema
 * work on the agent's render path. WAL plus a busy timeout (see `db.ts`) is
 * what makes two connections to one file safe.
 */
export interface AuthConfig {
  /** Defaults to `$STAFFROOM_HOME/staffroom.db`. Tests point it at a temp file. */
  databasePath?: string
  /** Defaults to `STAFFROOM_AUTH_SECRET`, or a generated one kept on disk. */
  secret?: string
  baseURL?: string
}

export type Auth = ReturnType<typeof createAuth>

export function createAuth(config: AuthConfig = {}) {
  const databasePath = config.databasePath ?? join(STAFFROOM_HOME, "staffroom.db")
  const baseURL = config.baseURL ?? process.env.STAFFROOM_URL ?? "http://127.0.0.1:4317"
  // Carries the "this is the first account" signal from the create `before` hook
  // (which sees no account yet) to `after` (which has the new user's id), so the
  // Default team is created without re-counting across DB connections.
  let firstAccountPending = false
  return betterAuth({
    database: openConnection(databasePath),
    secret: config.secret ?? resolveAuthSecret(),
    baseURL,
    // better-auth refuses a request whose Origin is not trusted (its CSRF
    // guard). The app is served same-origin, so the real origin is whatever
    // the deployment runs on — set STAFFROOM_URL to it in production, which
    // `baseURL` uses. In development we trust any localhost/127.0.0.1 port
    // (a wildcard better-auth supports), so `pnpm dev` keeps working whatever
    // ports the SPA and API run on — the last port change silently broke this.
    trustedOrigins: [baseURL, ...devTrustedOrigins()],
    emailAndPassword: {
      // A small self-hosted team. No email round trip to run, and nothing to
      // configure before the first account exists.
      enabled: true,
      requireEmailVerification: false,
    },
    // Roles. `admin` owns the shared surfaces — the tool catalog, the org skill
    // directory, accounts — while an ordinary user owns only their own roster.
    // `apiKey` mints personal keys for the CLI: a request carrying the key in
    // `x-api-key` resolves to a session for the key's user (so `getSession`, and
    // therefore `resolveCaller`, treat it exactly like a cookie login). That last
    // part is off by default — `enableSessionForAPIKeys` is what makes the key
    // stand in for a session; without it `getSession` ignores the header.
    //
    // Rate limiting is off too: the plugin defaults every key to 10 requests a
    // day, which a CLI blows through in one command. These are a person's own
    // keys against their own self-hosted server, not a public API quota.
    //
    // `localSignIn` is how the desktop app signs in its local, single-user
    // server's one account; it is inert anywhere else (see core/local-sign-in).
    plugins: [
      admin(),
      apiKey({ enableSessionForAPIKeys: true, rateLimit: { enabled: false } }),
      localSignIn(),
    ],
    databaseHooks: {
      user: {
        create: {
          // The first account to exist runs the place, so make it an admin — the
          // `admin` plugin does not do this on its own. Sign-up closes after it
          // (see create-app), so this fires once; any later account (added with
          // STAFFROOM_OPEN_SIGNUP) keeps the default role.
          before: async (user) => {
            if (anyAccountExists()) return undefined
            firstAccountPending = true
            return { data: { ...user, role: "admin" } }
          },
          // And put that first admin in a "Default" team, so the deployment has a
          // team to grant tools through without any manual setup.
          after: async (user) => {
            if (!firstAccountPending) return
            firstAccountPending = false
            const team = getTeamStore().create("Default")
            getTeamStore().setMembers(team.id, [(user as { id: string }).id])
          },
        },
      },
    },
  })
}

/**
 * Localhost origins trusted only in development, on any port — so the SPA and
 * API dev ports can change without breaking sign-in/out. Empty in production,
 * where the only trusted origin is the deployment's own (`baseURL`).
 */
function devTrustedOrigins(): string[] {
  if (process.env.NODE_ENV === "production") return []
  return ["http://localhost:*", "http://127.0.0.1:*"]
}

/**
 * Create better-auth's tables if they are not there yet.
 *
 * Run at boot rather than as a separate CLI step, so a fresh checkout and a
 * fresh deployment both just work, and so a schema that is behind the library
 * fails the process on start instead of failing someone's first login.
 */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}

let instance: Auth | undefined

/** The process-wide auth instance, built lazily on first use. */
export function getAuth(): Auth {
  if (!instance) instance = createAuth()
  return instance
}
