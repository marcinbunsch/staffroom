/**
 * The API client for the browser. All mechanics — fetch, the Hono RPC envelopes,
 * error shaping, the SSE stream — live in `@staffroom/client`; this module only
 * instantiates it for the same-origin, cookie-authed browser case and re-exports
 * the types the UI reads. The UI never touches a URL or a status code directly.
 */
import { createClient } from "@staffroom/client"

export * from "@staffroom/client"

/** The shared, same-origin client instance the whole UI consumes. */
export const api = createClient()
