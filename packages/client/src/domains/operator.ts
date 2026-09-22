import { type OperatorEvent, OperatorEvent as OperatorEventSchema } from "@staffroom/protocol"
import type { OperatorProfileRoutes } from "@staffroom/server/routes"
import { hc } from "hono/client"
import { type DomainContext, apiError } from "../http.ts"

/** The operator profile — who this account's staff work for. Read and written per caller. */
export function operatorDomain(ctx: DomainContext) {
  const rpc = hc<OperatorProfileRoutes>(`${ctx.base}/api/operator/profile`, ctx.hcInit)
  return {
    getProfile: async () => {
      const res = await rpc.index.$get()
      if (!res.ok) throw await apiError(res)
      return (await res.json()).profile
    },
    setProfile: async (text: string) => {
      const res = await rpc.index.$put({ json: { text } })
      if (!res.ok) throw await apiError(res)
      return (await res.json()).profile
    },
  }
}

/**
 * The operator event stream (SSE), as a `subscribe(onEvent)` returning an
 * unsubscribe. Native `EventSource` — the cookie rides along same-origin and it
 * reconnects on its own; a malformed frame is dropped rather than tearing the
 * stream down. (A CLI on token auth will need a fetch-stream variant, since
 * `EventSource` cannot set headers.)
 */
export function makeSubscribe(ctx: DomainContext) {
  return (onEvent: (event: OperatorEvent) => void): (() => void) => {
    const source = new EventSource(`${ctx.base}/api/operator/stream`, {
      withCredentials: ctx.base !== "",
    })
    source.onmessage = (message) => {
      const parsed = OperatorEventSchema.safeParse(safeJson(message.data))
      if (parsed.success) onEvent(parsed.data)
    }
    return () => source.close()
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
