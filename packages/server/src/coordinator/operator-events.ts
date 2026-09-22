/**
 * The operator event bus — the push side of the UI's data layer.
 *
 * Coordinator write-paths `publish()` a content-free "this slice changed"
 * signal; the SSE endpoint (`operator-routes.ts`) fans it out to every connected
 * browser, which refetches just that slice. So the client stops polling on a
 * timer and instead reacts to what actually moved.
 *
 * The events carry **no data**, only a shape and a tenant — an event is a
 * doorbell, not a delivery. That keeps the bus out of the isolation story: a
 * refetch returns only the caller's own rows regardless of who rang. Where a
 * publisher knows the tenant it scopes the envelope; where it does not (a job
 * pulse that fans in from many places), it broadcasts, and the worst case is a
 * browser refetching a slice that was someone else's — content-safe, just a
 * little extra work.
 */

import type { OperatorEvent } from "@staffroom/protocol"

/** A published event plus who it is for. `tenantId` undefined = broadcast to all. */
export interface OperatorEnvelope {
  tenantId?: string
  event: OperatorEvent
}

type Listener = (envelope: OperatorEnvelope) => void

export class OperatorEvents {
  readonly #listeners = new Set<Listener>()

  publish(envelope: OperatorEnvelope): void {
    for (const listener of this.#listeners) {
      // A slow or throwing subscriber must never break the write-path that rang
      // the bell — presence and badges are downstream of real work, not it.
      try {
        listener(envelope)
      } catch (error) {
        console.warn("[operator-events] a subscriber threw:", error)
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}

let bus: OperatorEvents | undefined

export function getOperatorEvents(): OperatorEvents {
  if (!bus) bus = new OperatorEvents()
  return bus
}
