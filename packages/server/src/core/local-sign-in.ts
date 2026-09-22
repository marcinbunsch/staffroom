import { timingSafeEqual } from "node:crypto"
import { userInfo } from "node:os"
import type { BetterAuthPlugin, User } from "better-auth"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"
import { singleUserMode } from "./config.ts"

/**
 * Signing in to a single-user server on the user's behalf.
 *
 * The desktop app can run a server of its own on loopback, and it is the
 * one client that should get in without a password. For each server it starts
 * it generates a token, hands it over in `STAFFROOM_LOCAL_TOKEN`, and opens its
 * window on `GET /api/auth/local/sign-in` with the token in a header — never in
 * the URL, so it lands in no history or log. A match signs in the server's one
 * account (creating it on first run), sets the ordinary better-auth session
 * cookie, and redirects to the app, which from there is exactly the UI a browser
 * gets.
 *
 * A browser pointed at the same port has no token: it gets the sign-in page, and
 * no account with a password to sign in to. On a shared server the endpoint is
 * inert — it answers 404.
 */
export const LOCAL_TOKEN_HEADER = "x-staffroom-local-token"

/** The one account's email. Never mailed; `.localhost` resolves nowhere else. */
const LOCAL_EMAIL = "you@staffroom.localhost"

export function localSignIn() {
  return {
    id: "staffroom-local-sign-in",
    endpoints: {
      localSignIn: createAuthEndpoint(
        "/local/sign-in",
        { method: "GET", requireHeaders: true },
        async (ctx) => {
          const expected = process.env.STAFFROOM_LOCAL_TOKEN?.trim()
          if (!singleUserMode() || !expected) throw APIError.fromStatus("NOT_FOUND")
          if (!tokensMatch(ctx.headers?.get(LOCAL_TOKEN_HEADER), expected)) {
            throw APIError.fromStatus("UNAUTHORIZED")
          }

          // The earliest account is the one account: normally the one this
          // endpoint created on first run. Created through better-auth, so the
          // first-account hooks make it an admin in the Default team.
          const [existing] = await ctx.context.adapter.findMany<User>({
            model: "user",
            sortBy: { field: "createdAt", direction: "asc" },
            limit: 1,
          })
          const user =
            existing ??
            (await ctx.context.internalAdapter.createUser(
              { email: LOCAL_EMAIL, name: localName(), emailVerified: true },
              { method: "local" },
            ))

          // Not `dontRememberMe`: the session outlives the app, so a relaunch stays signed in.
          const session = await ctx.context.internalAdapter.createSession(user.id, false)
          await setSessionCookie(ctx, { session, user })
          throw ctx.redirect("/")
        },
      ),
    },
  } satisfies BetterAuthPlugin
}

function tokensMatch(given: string | null | undefined, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The OS account's name, as a friendlier default than the email. */
function localName(): string {
  try {
    return userInfo().username || "You"
  } catch {
    return "You"
  }
}
