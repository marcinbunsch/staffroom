import { createClient } from "@staffroom/client"
import type { Account } from "./config.ts"

/**
 * A Staffroom API client bound to a stored account. Same client the UI uses —
 * so a command can never disagree with the web about what an endpoint means —
 * pointed at the account's server and carrying its key in `x-api-key`, the
 * header the better-auth apiKey plugin reads to resolve a session.
 */
export function clientFor(account: Account) {
  return createClient({
    baseUrl: account.url.replace(/\/+$/, ""),
    headers: { "x-api-key": account.key },
  })
}
