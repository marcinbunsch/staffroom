import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Everything Staffroom owns on disk lives under one home directory: Flue's
 * `flue.db`, the operational `staffroom.db`, the audit log, and file bytes.
 *
 * A production install keeps it in `~/.staffroom`. A dev run keeps it inside the
 * checkout instead — `<workspace>/.staffroom` — so each git worktree gets its
 * own disposable database and its own migration history. Sharing one home across
 * worktrees is how a branch ends up booting against a schema another branch
 * migrated, which the migrator rightly refuses. Dev is detected the same way the
 * rest of the server detects it: `NODE_ENV`, which Vite sets to `development`
 * from source and inlines as `production` in the built bundle.
 *
 * `STAFFROOM_HOME` overrides both, which is how tests point at a temp dir and a
 * deployment points wherever it keeps state.
 */
export const STAFFROOM_HOME = resolveHome()

function resolveHome(): string {
  const override = process.env.STAFFROOM_HOME?.trim()
  if (override) return override
  // cwd in dev is `packages/server` (the workspace package the dev script runs
  // in), so `../..` is the worktree root — the same anchor the dev script uses
  // for `--env-file-if-exists=../../.env`.
  if (process.env.NODE_ENV !== "production") return join(process.cwd(), "..", "..", ".staffroom")
  return join(homedir(), ".staffroom")
}

/**
 * The server's own public base URL, for building OAuth redirect URIs that point
 * at the server's `/oauth/*` routes — not the client origin, which in dev is the
 * Vite proxy. Set `STAFFROOM_URL` in production; the default is the dev server.
 * The value registered with an OAuth provider is `<this>/oauth/<name>/callback`.
 */
export function serverBaseUrl(): string {
  return (process.env.STAFFROOM_URL ?? "http://127.0.0.1:4317").replace(/\/+$/, "")
}

/**
 * Whether this server runs for exactly one person — the desktop app's local server,
 * which starts its own server on loopback. There is one account, created and
 * signed in by the app itself (see `core/local-sign-in`), so sign-up is closed
 * and teams stop gating toolsets: there is nobody else to keep them from. Set by
 * the desktop app; never on a shared deployment.
 */
export function singleUserMode(): boolean {
  return process.env.STAFFROOM_SINGLE_USER === "1"
}

/**
 * The secret better-auth signs sessions and tokens with.
 *
 * `STAFFROOM_AUTH_SECRET` wins when it is set — that is how a deployment keeps
 * the secret in its own secret store, or shares one across several machines.
 * Otherwise we generate 32 random bytes and **keep** them in
 * `$STAFFROOM_HOME/auth-secret`, so a self-hosted install needs no
 * configuration to start.
 *
 * Persisting is the whole point of the file. A secret regenerated on every
 * boot would invalidate every signed session, so restarting the server would
 * silently sign everyone out — the opposite of the durability the rest of the
 * system works hard for.
 */
export function resolveAuthSecret(): string {
  return resolveSecret("STAFFROOM_AUTH_SECRET", "auth-secret")
}

/**
 * The key that encrypts stored secrets — model-provider API keys, imported
 * Codex tokens, and later the tool catalog's credentials.
 *
 * Resolved exactly like the auth secret, and for the same reason: losing it
 * is not a re-login, it is every stored credential becoming unreadable.
 *
 * The honest limit, restated from the plan: this protects a stolen backup, a
 * synced folder or a disk image. It does not protect against someone who
 * already has the process environment — the key sits next to the database it
 * unlocks unless a deployment sets STAFFROOM_SECRET_KEY from somewhere else.
 */
export function resolveEncryptionKey(): string {
  return resolveSecret("STAFFROOM_SECRET_KEY", "secret-key")
}

/**
 * APNs credentials, for sending push notifications to the iOS app.
 *
 * All four come from the environment, and all four are required — push is off
 * until every one is set, so a dev or self-hosted install runs fine with none
 * of them. The signing key is the contents of the `.p8` file Apple issues; a
 * deployment can pass it inline (`STAFFROOM_APNS_KEY`) or point at the file
 * (`STAFFROOM_APNS_KEY_FILE`), the latter being the usual shape for a secret
 * mounted into a container.
 *
 * `production` selects Apple's push host: the sandbox gateway for development
 * builds (Xcode/TestFlight run against sandbox), the production gateway for App
 * Store builds. Default is sandbox, since that is what a dev device uses.
 */
export interface ApnsConfig {
  /** The `.p8` signing key contents (PEM). */
  key: string
  /** The key's 10-char identifier (Apple Developer → Keys). */
  keyId: string
  /** The 10-char Apple Developer team identifier. */
  teamId: string
  /** The app's bundle id — the APNs `apns-topic`. */
  bundleId: string
  /** Sandbox gateway unless STAFFROOM_APNS_PRODUCTION is set. */
  production: boolean
}

export function apnsConfig(): ApnsConfig | undefined {
  const key = resolveApnsKey()
  const keyId = process.env.STAFFROOM_APNS_KEY_ID?.trim()
  const teamId = process.env.STAFFROOM_APNS_TEAM_ID?.trim()
  const bundleId = process.env.STAFFROOM_APNS_BUNDLE_ID?.trim()
  if (!key || !keyId || !teamId || !bundleId) return undefined
  return {
    key,
    keyId,
    teamId,
    bundleId,
    production: Boolean(process.env.STAFFROOM_APNS_PRODUCTION),
  }
}

function resolveApnsKey(): string | undefined {
  const inline = process.env.STAFFROOM_APNS_KEY?.trim()
  if (inline) return inline
  const file = process.env.STAFFROOM_APNS_KEY_FILE?.trim()
  if (!file) return undefined
  return readSecretFile(file)
}

/**
 * Web Push (VAPID) credentials, for notifications to browsers and installed
 * PWAs — the channel that needs no Apple account, unlike APNs.
 *
 * The keypair is a P-256 pair you generate once and keep
 * (`pnpm --filter @staffroom/server vapid`): the public key is base64url of the
 * uncompressed EC point (the client's `applicationServerKey`), the private key
 * base64url of the 32-byte scalar. Both required, so web push is off until they
 * are set. `subject` is the VAPID `sub` claim push services want as a contact —
 * a `mailto:` or `https:` URL; it defaults to the server's own base URL.
 */
export interface WebPushConfig {
  publicKey: string
  privateKey: string
  subject: string
}

export function webPushConfig(): WebPushConfig | undefined {
  const publicKey = process.env.STAFFROOM_VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.STAFFROOM_VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return undefined
  const subject = process.env.STAFFROOM_VAPID_SUBJECT?.trim() || serverBaseUrl()
  return { publicKey, privateKey, subject }
}

function resolveSecret(variable: string, fileName: string): string {
  const fromEnvironment = process.env[variable]?.trim()
  if (fromEnvironment) return fromEnvironment
  return readOrCreateSecret(join(STAFFROOM_HOME, fileName), variable)
}

function readOrCreateSecret(path: string, variable: string): string {
  const existing = readSecretFile(path)
  if (existing) return existing

  mkdirSync(STAFFROOM_HOME, { recursive: true })
  const secret = randomBytes(32).toString("base64url")
  try {
    // `wx` fails rather than truncates if another process got there first, so
    // two servers starting together cannot end up with different secrets.
    writeFileSync(path, secret, { flag: "wx", mode: 0o600 })
    console.log(`[staffroom] generated ${variable} at ${path}`)
    return secret
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const raced = readSecretFile(path)
    if (!raced) throw error
    return raced
  }
}

function readSecretFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim() || undefined
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

function isNotFound(error: unknown): boolean {
  return hasCode(error, "ENOENT")
}

function isAlreadyExists(error: unknown): boolean {
  return hasCode(error, "EEXIST")
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}
