import { adminClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/**
 * The better-auth client. Same-origin, so it needs no baseURL — sign-in and
 * sign-up set the session cookie, and every subsequent API call carries it.
 * The admin plugin mirrors the server's, exposing the role on the session.
 */
export const auth = createAuthClient({
  plugins: [adminClient()],
})

export const { useSession, signIn, signUp, signOut } = auth
