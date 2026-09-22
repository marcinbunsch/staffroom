import { randomUUID } from "node:crypto"
import {
  type EventEnvelope,
  type EventEnvelopeInput,
  type EventMatch,
  MAX_EVENT_DEPTH,
  type Subscription,
} from "@staffroom/protocol"
import { type ChatStore, getChatStore } from "./chats.ts"
import { getJobsCoordinator } from "./jobs.ts"
import type { JobsCoordinator } from "./jobs.ts"
import { getSchedulesStore } from "./schedules-store.ts"

/**
 * Something that can supply subscriptions to the bus. Schedules derive theirs
 * from the schedules store; stored subscriptions (file watches, later) would add
 * another source. The bus asks every source on each publish rather than holding
 * its own registry, so there is never a copy to keep in sync.
 */
export type SubscriptionSource = () => Subscription[]

export interface BusReaction {
  subscriptionId: string
  jobId: number
}

/**
 * The event bus: an event that matches a subscription opens a job.
 *
 * The reaction is deliberately the only thing it does. A job carries a session,
 * a timeline, caps, a deadline and cost attribution, so "react to an event" is
 * ordinary job history rather than a parallel mechanism to inspect.
 */
export class EventBus {
  readonly #sources: SubscriptionSource[]
  readonly #jobs: JobsCoordinator
  readonly #chats: Pick<ChatStore, "main">

  constructor(
    sources: SubscriptionSource[],
    jobs: JobsCoordinator,
    chats: Pick<ChatStore, "main"> = getChatStore(),
  ) {
    this.#sources = sources
    this.#jobs = jobs
    this.#chats = chats
  }

  /**
   * Publish an event and open a job for every subscription it matches. Returns
   * the reactions, for the caller to log; a subscription refused by the cycle
   * guard or the depth cap simply does not appear.
   */
  publish(input: EventEnvelopeInput): { envelope: EventEnvelope; reactions: BusReaction[] } {
    const envelope: EventEnvelope = {
      id: randomUUID(),
      at: new Date().toISOString(),
      chain: input.chain ?? [],
      depth: input.depth ?? 0,
      scope: input.scope ?? "tenant",
      ...input,
    }

    const reactions: BusReaction[] = []
    if (envelope.depth > MAX_EVENT_DEPTH) {
      // Runaway fan-out that never repeats a subscription. Refuse the whole
      // event rather than each match: nothing below this depth is legitimate.
      console.warn(
        `[bus] dropping "${envelope.type}" at depth ${envelope.depth} (cap ${MAX_EVENT_DEPTH})`,
      )
      return { envelope, reactions }
    }

    for (const subscription of this.#matching(envelope)) {
      // The cycle guard: a subscription already in this event's chain would
      // loop. Refused exactly, with no threshold — the chain is the record.
      if (envelope.chain.includes(subscription.id)) continue
      reactions.push(this.#react(envelope, subscription))
    }
    return { envelope, reactions }
  }

  #matching(envelope: EventEnvelope): Subscription[] {
    const matched: Subscription[] = []
    for (const source of this.#sources) {
      for (const subscription of source()) {
        if (!subscription.enabled) continue
        // Tenant-scoped by default: a subscription only sees its own tenant's
        // events. `org` is the short, named exception a producer opts into.
        if (envelope.scope !== "org" && subscription.tenantId !== envelope.tenantId) continue
        if (matches(envelope, subscription.match)) matched.push(subscription)
      }
    }
    return matched
  }

  #react(envelope: EventEnvelope, subscription: Subscription): BusReaction {
    const job = this.#jobs.create({
      tenantId: subscription.tenantId,
      title: subscription.title,
      instruction: subscription.instruction,
      actor: { kind: "system" },
      // A schedule has no chat it came from, so its completion lands in the
      // agent's current main chat — resolved (not hardcoded to the bare
      // session) so it still works after the main has been started over.
      originatorAgent: subscription.agent,
      originatorSession: this.#chats.main(subscription.tenantId, subscription.agent).session,
      assignee: subscription.agent,
      deadlineAt: deadlineFrom(subscription.deadlineSeconds),
      // Schedule jobs are silent by default: the completion lands in the main
      // chat only when the assignee opts in at close. The schedule sets this.
      reportMode: subscription.reportMode,
    })
    return { subscriptionId: subscription.id, jobId: job.id }
  }
}

/**
 * Does an envelope satisfy a matcher? Type equality, then every `where` key
 * equal to the corresponding field. `where` reads from a flat view of the
 * envelope — its `source` plus its payload — so both a top-level field like
 * `source` and a payload field like `visibility` can be matched the same way.
 *
 * An array field matches by membership, not equality: `where: { labels: "x" }`
 * against a `file.created` carrying `labels: ["x", "y"]` fires — which is how a
 * schedule subscribes to "a new file tagged x".
 */
export function matches(envelope: EventEnvelope, match: EventMatch): boolean {
  if (envelope.type !== match.type) return false
  if (!match.where) return true
  const view: Record<string, unknown> = { source: envelope.source, ...envelope.payload }
  return Object.entries(match.where).every(([key, value]) => {
    const field = view[key]
    return Array.isArray(field) ? field.includes(value) : field === value
  })
}

function deadlineFrom(seconds: number | null): string | undefined {
  if (seconds === null) return undefined
  return new Date(Date.now() + seconds * 1000).toISOString()
}

let bus: EventBus | undefined

/**
 * The process-wide bus, wired to the schedules store's derived subscriptions.
 * More sources (a stored-subscription store) join here as they arrive.
 */
export function getEventBus(): EventBus {
  if (!bus) {
    bus = new EventBus([() => getSchedulesStore().subscriptions()], getJobsCoordinator())
  }
  return bus
}
