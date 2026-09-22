import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

/**
 * A stored login: the server it points at and the API key to authenticate with.
 * The key is the plaintext value minted in the UI (shown once); we hold it so
 * the CLI can act as that user without a browser session.
 */
export interface Account {
  url: string
  key: string
}

/**
 * The CLI's on-disk state: a set of named accounts and which one is the default.
 * Modelled after `~/.aws/credentials` — several profiles, one active. Lives in
 * `$STAFFROOM_HOME/cli-credentials.json` at mode 0600 because it holds secrets.
 */
export interface Credentials {
  default?: string
  accounts: Record<string, Account>
}

const home = process.env.STAFFROOM_HOME ?? join(homedir(), ".staffroom")
export const credentialsPath = join(home, "cli-credentials.json")

export function loadCredentials(): Credentials {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath, "utf8")) as Partial<Credentials>
    return { default: parsed.default, accounts: parsed.accounts ?? {} }
  } catch (error) {
    if (isNotFound(error)) return { accounts: {} }
    throw error
  }
}

export function saveCredentials(credentials: Credentials): void {
  mkdirSync(dirname(credentialsPath), { recursive: true })
  writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  // `mode` on writeFileSync only applies when creating the file, so tighten an
  // already-existing one too — the secrets inside must never be world-readable.
  chmodSync(credentialsPath, 0o600)
}

/**
 * Pick the account a command should act as: an explicit `--account` name when
 * given, otherwise the default. Throws a message meant to be shown as-is when
 * nothing resolves, so callers need no bespoke error text.
 */
export function resolveAccount(credentials: Credentials, name: string | undefined): Account {
  const target = name ?? credentials.default
  if (!target) {
    throw new Error("No account selected. Run `staffroom login <name>` first, or pass --account.")
  }
  const account = credentials.accounts[target]
  if (!account) throw new Error(`Unknown account "${target}". See \`staffroom accounts\`.`)
  return account
}

/** Show enough of a key to recognise it, never enough to use it. */
export function maskKey(key: string): string {
  return key.length <= 8 ? "…" : `${key.slice(0, 6)}…${key.slice(-2)}`
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  )
}
