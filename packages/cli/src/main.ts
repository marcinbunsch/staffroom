#!/usr/bin/env node

import { ApiError } from "@staffroom/client"
import { type Flags, flag, parseArgs } from "./args.ts"
import { clientFor } from "./client.ts"
import { loadCredentials, maskKey, saveCredentials } from "./config.ts"
import { filesCommand } from "./commands/files.ts"
import { ask, askSecret } from "./prompt.ts"
import { openClient } from "./session.ts"

const DEFAULT_URL = "http://127.0.0.1:4317"

/**
 * `staffroom` — a thin HTTP client over the server's API. It holds no logic of
 * its own: every command is a request, so the CLI and the UI cannot drift into
 * disagreeing about what something means. Auth is a set of named accounts (each
 * a server URL + an API key), one marked default; see `staffroom help`.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv)
  const [command, ...rest] = positionals

  switch (command ?? "help") {
    case "help":
      printHelp()
      return 0
    case "login":
      return login(rest[0], flags)
    case "accounts":
    case "list":
      return listAccounts()
    case "use":
      return use(rest[0])
    case "logout":
    case "remove":
      return logout(rest[0])
    case "whoami":
      return whoami(flag(flags.account))
    case "files":
      return filesCommand(rest, flags)
    default:
      console.error(`Unknown command "${command}". Run \`staffroom help\`.`)
      return 1
  }
}

/**
 * Store an account. The key is verified against the server before it is saved,
 * so a bad paste fails now rather than on the first real command. The first
 * account added, or any added with --default, becomes the default.
 */
async function login(name: string | undefined, flags: Flags): Promise<number> {
  if (!name) {
    console.error("Usage: staffroom login <name> [--url <url>] [--key <key>] [--default]")
    return 1
  }
  const credentials = loadCredentials()
  const url = (flag(flags.url) ?? (await ask(`Server URL [${DEFAULT_URL}]: `))) || DEFAULT_URL
  const key = flag(flags.key) ?? (await askSecret("API key: "))
  if (!key) {
    console.error("An API key is required. Mint one in the web app under Settings → API keys.")
    return 1
  }

  const account = { url, key }
  try {
    const me = await clientFor(account).me()
    console.log(`Verified — ${me.role} on ${url}.`)
  } catch (error) {
    console.error(`Could not verify the key: ${describe(error)}`)
    return 1
  }

  credentials.accounts[name] = account
  if (flags.default === true || !credentials.default) credentials.default = name
  saveCredentials(credentials)
  const marker = credentials.default === name ? " (default)" : ""
  console.log(`Saved account "${name}"${marker}.`)
  return 0
}

function listAccounts(): number {
  const credentials = loadCredentials()
  const names = Object.keys(credentials.accounts)
  if (names.length === 0) {
    console.log("No accounts yet. Run `staffroom login <name>`.")
    return 0
  }
  for (const name of names.sort()) {
    const account = credentials.accounts[name]
    if (!account) continue
    const marker = credentials.default === name ? "*" : " "
    console.log(`${marker} ${name}\t${account.url}\t${maskKey(account.key)}`)
  }
  return 0
}

function use(name: string | undefined): number {
  if (!name) {
    console.error("Usage: staffroom use <name>")
    return 1
  }
  const credentials = loadCredentials()
  if (!credentials.accounts[name]) {
    console.error(`Unknown account "${name}". See \`staffroom accounts\`.`)
    return 1
  }
  credentials.default = name
  saveCredentials(credentials)
  console.log(`Default account is now "${name}".`)
  return 0
}

/** Remove an account; if it was the default, hand default to whatever remains. */
function logout(name: string | undefined): number {
  if (!name) {
    console.error("Usage: staffroom logout <name>")
    return 1
  }
  const credentials = loadCredentials()
  if (!credentials.accounts[name]) {
    console.error(`Unknown account "${name}".`)
    return 1
  }
  delete credentials.accounts[name]
  if (credentials.default === name) {
    credentials.default = Object.keys(credentials.accounts)[0]
  }
  saveCredentials(credentials)
  console.log(`Removed account "${name}".`)
  return 0
}

async function whoami(name: string | undefined): Promise<number> {
  try {
    const { account, client } = openClient(name)
    const me = await client.me()
    console.log(`${me.tenantId} — ${me.role} on ${account.url}`)
    return 0
  } catch (error) {
    console.error(describe(error))
    return 1
  }
}

function printHelp(): void {
  console.log(`staffroom — Staffroom CLI

Usage:
  staffroom <command> [options]

Accounts:
  login <name>     Add an account and make it default if it is the first.
                   Options: --url <url>, --key <key>, --default
  accounts         List saved accounts; * marks the default.
  use <name>       Set the default account.
  logout <name>    Remove a saved account.
  whoami           Show who the active account authenticates as.

Files:
  files list                  List files.  Options: --label <label>
  files upload <path...>      Upload files.  Options: --agent <id>, --label a,b,
                              --name <name>, --org (share with the org)
  files download <id>         Download bytes.  Options: -o, --out <path|dir>
  files label <id> <label...> Replace a file's labels (none clears them).
  files share <id>            Share a file with the org.
  files unshare <id>          Make a file private again.
  files rm <id>               Delete a file.

Global:
  -a, --account <name>   Act as a named account instead of the default.

API keys are minted in the web app under Settings → API keys.`)
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.status})`
  return error instanceof Error ? error.message : String(error)
}

process.exitCode = await main(process.argv.slice(2))
