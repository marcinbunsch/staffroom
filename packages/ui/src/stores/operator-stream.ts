import { api, type OperatorEvent } from "../lib/api.ts"

/**
 * The operator event stream, consumed through the client's `subscribe` — the
 * transport (a native `EventSource`, cookie-authed same-origin, self-reconnecting)
 * lives in `@staffroom/client`, so this is just the UI's thin entry point.
 */
export type { OperatorEvent }

export function watchOperatorStream(onEvent: (event: OperatorEvent) => void): () => void {
  return api.subscribe(onEvent)
}
