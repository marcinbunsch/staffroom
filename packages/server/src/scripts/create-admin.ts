/**
 * Bootstrap (or recover) the first admin account, in-process.
 *
 *   pnpm --filter @staffroom/server admin <email>          # create if missing
 *   pnpm --filter @staffroom/server admin <email> --reset  # set a new password
 *
 * The very first admin cannot be made through the admin API — that would need
 * an admin to already exist. So this runs *inside* the server: it calls
 * better-auth's own API through the same connection the server uses, so the
 * write commits and is immediately visible, with no HTTP round trip, no
 * Origin/CSRF dance, and no second database handle that can only see a stale
 * snapshot.
 *
 * The password is generated and printed once — we never store it. If the
 * account already exists and you have lost it, `--reset` sets a fresh one.
 * Every account after this one is created and promoted in-app.
 */
import { randomBytes } from "node:crypto"
import { getAuth, runAuthMigrations } from "../core/auth.ts"

const args = process.argv.slice(2)
const reset = args.includes("--reset")
const EMAIL = args.find((arg) => !arg.startsWith("--"))
if (!EMAIL) {
  console.error("Usage: pnpm --filter @staffroom/server admin <email> [--reset]")
  process.exit(1)
}
// 18 url-safe bytes: strong, and printable without quoting surprises.
const password = randomBytes(18).toString("base64url")

const auth = getAuth()
// A fresh checkout has no auth tables yet; this is idempotent on an existing db.
await runAuthMigrations(auth)
const ctx = await auth.$context

let outcome: "created" | "reset" | "unchanged"

const existing = await ctx.adapter.findOne<{ id: string }>({
  model: "user",
  where: [{ field: "email", value: EMAIL }],
})

if (!existing) {
  // New account: better-auth hashes the password and writes the credential row.
  await auth.api.signUpEmail({
    body: { email: EMAIL, password, name: EMAIL.split("@")[0] ?? EMAIL },
  })
  outcome = "created"
} else if (reset) {
  // Recover a lost password: hash a fresh one and swap it on the credential
  // account, through the same internal path better-auth's own reset uses.
  const hashed = await ctx.password.hash(password)
  await ctx.internalAdapter.updatePassword(existing.id, hashed)
  outcome = "reset"
} else {
  outcome = "unchanged"
}

// Ensure the role is admin regardless of which branch ran.
const updated = await ctx.adapter.update({
  model: "user",
  where: [{ field: "email", value: EMAIL }],
  update: { role: "admin" },
})
if (!updated) {
  console.error(`\nNo user row for ${EMAIL} — nothing was promoted.\n`)
  process.exit(1)
}

console.log("\n  ✓ admin account ready\n")
console.log(`    email:    ${EMAIL}`)
if (outcome === "unchanged") {
  console.log("    password: (unchanged — this account already exists)")
  console.log("\n  Lost it? Re-run with --reset to set a new one.\n")
} else {
  console.log(`    password: ${password}`)
  console.log("")
}
process.exit(0)
