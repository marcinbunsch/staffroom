import { clientFor } from "./client.ts"
import { type Account, loadCredentials, resolveAccount } from "./config.ts"

/**
 * Open the API client for the account a command should act as — the `--account`
 * name when given, otherwise the default. Throws the resolver's own message
 * (meant to be shown as-is) when nothing resolves, so commands need no bespoke
 * "not logged in" handling.
 */
export function openClient(accountName: string | undefined): {
  account: Account
  client: ReturnType<typeof clientFor>
} {
  const account = resolveAccount(loadCredentials(), accountName)
  return { account, client: clientFor(account) }
}
