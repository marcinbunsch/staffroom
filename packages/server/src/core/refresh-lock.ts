/**
 * Serialize token refreshes per stored credential.
 *
 * Providers that rotate refresh tokens (GitHub, Notion) revoke the old one the
 * moment a refresh succeeds. An agent turn fires several tool calls at once, so
 * without this two of them would read the same expiring credential, refresh in
 * parallel, and the loser would present a token the winner had already revoked —
 * a `bad_refresh_token` that also leaves the newest token overwritten by a dead
 * one. Queueing per credential key makes the second caller re-read the freshly
 * stored credential and take the cache path instead.
 *
 * In-process only, which is what a single-server deployment needs; several
 * server processes sharing one database would need the lock in the database.
 */

const chains = new Map<string, Promise<void>>()

/** Run `work` after any refresh already queued for `key`, and queue behind it. */
export function withRefreshLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = chains.get(key)
  const result = prior ? prior.then(work) : work()
  // The chain link must never reject, or every later caller would inherit the
  // failure; a failed refresh is the next caller's problem to retry, not to catch.
  const link = result.then(
    () => {},
    () => {},
  )
  chains.set(key, link)
  void link.then(() => {
    // Only the tail clears itself — a later caller may already have queued behind.
    if (chains.get(key) === link) chains.delete(key)
  })
  return result
}
