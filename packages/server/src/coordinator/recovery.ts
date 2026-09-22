import { observe } from "@flue/runtime"
import type { FlueEvent } from "@flue/runtime"
import { parseSessionKey } from "@staffroom/protocol"
import { type JobsCoordinator, MAX_RECOVERY_ATTEMPTS, getJobsCoordinator } from "./jobs.ts"

/**
 * Recovery for job turns that die on a transient infrastructure failure.
 *
 * A model streaming WebSocket drops, or the provider answers 429/503, and Flue
 * raises `OperationFailedError: dispatch(sub_...) failed: WebSocket error` from
 * inside its own submission loop. Flue's durability retries only *interruptions*
 * (a reset or deploy consuming an attempt) — a thrown processing error like this
 * terminalizes the submission as `failed` and stays failed ("retry with a fresh
 * key"). So the turn stops, and because the failure happened in the background
 * loop — after our `dispatch()` already resolved at admission — it never reaches
 * the dispatcher's `.catch` in app.ts either. The job is left stranded (in
 * `working`, so the boot `redispatchAssigned` sweep — which only rescues
 * `assigned` — never finds it).
 *
 * This tap is the missing half. It observes Flue's own `submission_settled`
 * event, and when a *job* submission settles `failed` on a transient error it
 * re-drives the job with a fresh dispatch (the "fresh key" Flue asks for), under
 * a bounded backoff, giving up to a restartable `failed` only once the retries
 * are exhausted or the error is one a retry cannot fix. A clean `completed`
 * settlement resets the counter, so `attempts` counts consecutive failures
 * rather than lifetime ones.
 *
 * It is an `observe()` subscriber, the same "wrap once, centrally" seam
 * flue-audit and chat-activity already use — a per-dispatch wrapper is a thing
 * you can forget to add; a subscriber is not.
 */

/** A transient failure a retry can plausibly clear, vs. one it never will. */
const TRANSIENT_PATTERNS = [
  /websocket/i,
  /econnreset/i,
  /econnrefused/i,
  /etimedout/i,
  /enotfound/i,
  /socket hang up/i,
  /network/i,
  /\btimed? ?out\b/i,
  /\b(429|502|503|504)\b/i,
  /rate.?limit/i,
  /overloaded/i,
  /temporarily unavailable/i,
]

/**
 * Whether a dispatch/turn failure is worth retrying. Transient: a dropped
 * socket, a network blip, a 429/503, an overloaded provider, a submission
 * timeout. Everything else — a missing credential, a validation error, a
 * loop-cap breach — is permanent: retrying just fails again, so recovery gives
 * up at once. Unknown shapes are treated as permanent on purpose; a retry loop
 * is the worse failure mode.
 */
export function isTransientDispatchError(error: unknown): boolean {
  const text = describeError(error)
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * A human-readable one-liner for an error of any shape — a real `Error`, a
 * string, or Flue's serialized submission-error record (`{ name?, message,
 * meta? }`), whose `message` carries the "... failed: WebSocket error" text the
 * classifier keys on.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown }
    if (typeof message === "string") return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Backoff before the next re-drive, growing with the number of failures already
 * seen so a provider that is briefly down is not hammered. Deterministic (no
 * jitter) so a test can assert it.
 */
export function backoffMs(priorAttempts: number): number {
  const ladder = [2_000, 8_000, 30_000]
  return ladder[Math.min(priorAttempts, ladder.length - 1)] ?? 30_000
}

/** Injectable seams, so a test can drive recovery on a fake clock. */
export interface RecoveryDeps {
  jobs?: JobsCoordinator
  /** Defaults to an unref'd `setTimeout`; a test passes a synchronous timer. */
  setTimer?: (fn: () => void, ms: number) => void
}

/**
 * Wire the recovery tap. Wired once at boot alongside the other `observe()`
 * taps; returns the `observe()` disposer for tests.
 */
export function startJobRecovery(deps: RecoveryDeps = {}): () => void {
  const jobs = deps.jobs ?? getJobsCoordinator()
  const setTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      setTimeout(fn, ms).unref()
    })

  return observe((event: FlueEvent) => {
    try {
      handleEvent(event, jobs, setTimer)
    } catch (error) {
      // Recovery must never break the run it observes.
      console.warn("[recovery] failed to handle a Flue event:", error)
    }
  })
}

/** Exported for tests: the whole decision, pure of the `observe()` wrapper. */
export function handleEvent(
  event: FlueEvent,
  jobs: JobsCoordinator,
  setTimer: (fn: () => void, ms: number) => void,
): void {
  if (event.type !== "submission_settled") return
  const identity = event.instanceId ? parseSessionKey(event.instanceId) : undefined
  // Only job sessions have something to recover; a chat turn that fails is the
  // operator's to retry, and has no durable job record to re-drive.
  if (!identity || identity.jobId === undefined) return
  const { tenantId, jobId } = identity

  if (event.outcome === "completed") {
    // A turn settled cleanly — forget any earlier consecutive failures.
    jobs.resetAttempts(tenantId, jobId)
    return
  }
  // `aborted` is the operator's hard-stop or a torn-down submission — its job is
  // already being cancelled/failed on the path that aborted it; leave it alone.
  if (event.outcome !== "failed") return

  const reason = describeError(event.error)

  if (!isTransientDispatchError(event.error)) {
    // Nothing a retry fixes — fail it now (restartably) rather than looping.
    jobs.fail(tenantId, jobId, reason)
    return
  }

  const job = jobs.get(tenantId, jobId)
  if (!job) return
  if (job.attempts >= MAX_RECOVERY_ATTEMPTS) {
    jobs.fail(tenantId, jobId, `${reason} (gave up after ${job.attempts} recovery attempts)`)
    return
  }

  // Re-drive after a growing backoff. `recover` bumps `attempts` and dispatches
  // a fresh submission (the "fresh key" a failed submission needs); if that one
  // fails too it lands back here with a higher count until it exhausts.
  setTimer(() => {
    try {
      jobs.recover(tenantId, jobId, reason)
    } catch (error) {
      console.warn(`[recovery] re-drive of job #${jobId} failed:`, error)
    }
  }, backoffMs(job.attempts))
}
