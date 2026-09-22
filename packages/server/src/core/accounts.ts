import { getDatabase } from "../coordinator/database.ts"

/**
 * Whether any account exists yet — read straight off better-auth's `user` table
 * in the shared `staffroom.db`. Tolerates the table not existing (a first boot,
 * before auth migrations) by reporting none.
 *
 * Two first-run behaviours key off this: sign-up is open only while it is false
 * (see `create-app`), and the account created while it is false is promoted to
 * admin (see `core/auth` databaseHooks).
 */
export function anyAccountExists(): boolean {
  try {
    return getDatabase().connection.prepare("SELECT 1 FROM user LIMIT 1").get() !== undefined
  } catch {
    return false
  }
}
