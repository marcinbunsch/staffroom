import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { getOperatorEvents } from "../coordinator/operator-events.ts"
import type { SessionEnv } from "../middleware/session.ts"

/**
 * The operator event stream — one long-lived SSE connection per browser, the
 * push channel that replaces the UI's polling timers.
 *
 * It sits behind the same session gate as every other `/api/*` route, so the
 * cookie authenticates it and a native `EventSource` on the client just works
 * (no bearer token to thread). Each connection filters the bus to the caller's
 * own tenant plus the broadcast events, so one tenant never learns that
 * another's slice moved.
 */
export const operatorRoutes = new Hono<SessionEnv>()

operatorRoutes.get("/api/operator/stream", (context) => {
  const { tenantId } = context.get("caller")
  return streamSSE(context, async (stream) => {
    // Tell the client the stream is live so it can do its one initial load and
    // then trust the bell for everything after.
    await stream.writeSSE({ event: "ready", data: "1" })

    const unsubscribe = getOperatorEvents().subscribe((envelope) => {
      if (envelope.tenantId !== undefined && envelope.tenantId !== tenantId) return
      void stream.writeSSE({ data: JSON.stringify(envelope.event) })
    })

    // Hold the connection open until the client goes away; a periodic ping keeps
    // intermediaries from reaping an idle stream. Racing the sleep against abort
    // means a disconnect tears the subscription down at once, not a ping later.
    const closed = new Promise<void>((resolve) => stream.onAbort(resolve))
    try {
      while (!stream.aborted) {
        await Promise.race([stream.sleep(25_000), closed])
        if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "1" })
      }
    } finally {
      unsubscribe()
    }
  })
})
