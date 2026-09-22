import { dispatch, init } from "@flue/runtime"
import { createAgentRouter } from "@flue/runtime/routing"
import { parseSessionKey } from "@staffroom/protocol"
import { StaffAgent } from "./agents/staff-agent.ts"
import { getAuth, runAuthMigrations } from "./core/auth.ts"
import { setSessionDeliver } from "./coordinator/agent-messaging.ts"
import { getAttentionStore, setAttentionNotifier } from "./coordinator/attention.ts"
import { getOperatorEvents } from "./coordinator/operator-events.ts"
import { notify as pushNotify } from "./coordinator/push.ts"
import { getAuditDatabase } from "./coordinator/audit.ts"
import { migrateAuditToLatest } from "./coordinator/audit-schema.ts"
import { getDatabase } from "./coordinator/database.ts"
import { startChatActivity } from "./coordinator/chat-activity.ts"
import { startFlueAudit } from "./coordinator/flue-audit.ts"
import {
  backoffMs,
  describeError,
  isTransientDispatchError,
  startJobRecovery,
} from "./coordinator/recovery.ts"
import { initDockerSandbox } from "./tools/docker-sandbox.ts"
import { MAX_RECOVERY_ATTEMPTS, getJobsCoordinator } from "./coordinator/jobs.ts"
import { migrateToLatest } from "./coordinator/migrations.ts"
import { getScheduler } from "./coordinator/scheduler.ts"
import { createApp } from "./create-app.ts"
import { assertPluginsCompatible, pluginBootSummary } from "./core/plugins.ts"
import { registerStoredCredentials } from "./providers/registry.ts"
import { setAskAgentDeliver } from "./tools/ask-agent.ts"

/**
 * The composition root — the one module that imports everything, so nothing else
 * has to. `create-app.ts` holds the pipeline; this holds the wiring and the boot
 * side-effects, in the order they have to happen.
 */

/**
 * The boot work that must run **exactly once**, and complete before anything
 * serves — schema and the audit tap.
 *
 * Under Vite's dev SSR this module can be evaluated more than once. Two
 * concurrent `migrateToLatest` runs would interleave at their await points and
 * race to create the same table ("already exists"), and a second `observe()`
 * tap would double every audit row. So these sit behind a `globalThis`
 * once-guard.
 *
 * The agent *wiring* deliberately does NOT live here — see below.
 */
async function bootOnce(): Promise<void> {
  // Plugins first, before anything reads the tool catalog or integration types:
  // a plugin that shadows a built-in must stop the boot, not limp on. Plugin-vs-
  // plugin clashes already threw at `addPlugin`; this catches plugin-vs-built-in.
  assertPluginsCompatible()
  console.log(`[staffroom] ${pluginBootSummary()}`)

  // Schema first: every store reads through it, and a server on a half-migrated
  // database is the one case where carrying on does most damage.
  const { applied } = await migrateToLatest(getDatabase())
  await migrateAuditToLatest(getAuditDatabase())
  if (applied.length > 0) console.log(`[staffroom] applied ${applied.length} migration(s)`)

  // The audit tap, before anything can run a turn — cost not recorded as it
  // happens cannot be reconstructed.
  startFlueAudit()
  // The chat-activity tap: which chats are at work, unread, and last spoke.
  startChatActivity()
  // The recovery tap: re-drive a job whose turn died on a transient failure (a
  // dropped model WebSocket, a 429) that Flue's own submission loop won't retry.
  startJobRecovery()

  // Probe Docker once: the sandbox toolset is only offered if the daemon is up
  // and the image is built. Also clears containers a crash left behind.
  const sandboxOn = await initDockerSandbox()
  console.log(`[staffroom] Docker sandbox: ${sandboxOn ? "on" : "off"}`)

  // better-auth's own tables, so a fresh checkout just works.
  await runAuthMigrations(getAuth())

  // Providers come from stored credentials, so a restart comes back with the
  // same ones its jobs were running on. `setProvider` is idempotent.
  const providers = await registerStoredCredentials()
  console.log(`[staffroom] registered ${providers} model provider(s)`)
}

/**
 * Bind the coordinator to the agent, and start the scheduler.
 *
 * This runs on **every** evaluation, not behind the once-guard, and that is
 * load-bearing. `dispatch()`/`init()` resolve their target by exact function
 * value against Flue's registry, which each registration replaces wholesale. If
 * the module is evaluated more than once, the last evaluation's `StaffAgent` is
 * what ends up registered — so the dispatcher must be (re)bound to *that same*
 * evaluation's `StaffAgent`, or a background dispatch (a schedule-fired job, a
 * confirm-gate resume, an agent-to-agent call) targets an orphaned earlier
 * function and throws "target agent is not registered". Re-binding here every
 * time keeps the wired dispatcher and the registered agent the same value, the
 * way the prototype's top-level wiring did. Every call below is idempotent or
 * last-writer-wins, so repeating it is safe.
 */
function wireAgent(): void {
  const jobs = getJobsCoordinator()

  // A job going terminal cancels its pending confirm-gate approvals, so a late
  // approval can never wake a dead job.
  jobs.setTerminalListener((tenantId, jobId) => {
    getAttentionStore().cancelForJob(tenantId, jobId)
  })

  // Bridge the coordinator's own change pulse onto the operator bus, so the job
  // board updates from a push instead of a poll. The pulse is content-free and
  // fans in from many tenants, so it broadcasts — a browser refetches only its
  // own jobs. app.ts is the seam that already imports both.
  jobs.subscribe(() => {
    getOperatorEvents().publish({ event: { type: "job.state.changed" } })
  })

  // An agent escalation (the `attention_request` tool) or a confirm-gate raise
  // reaches the operator's phone as a push. The attention store rings a
  // content-free bell for the UI; this seam carries the content the
  // notification needs. A no-op until APNs is configured, so nothing fires in a
  // dev or self-hosted install without Apple credentials.
  setAttentionNotifier((notification) => {
    pushNotify(notification.tenantId, {
      title: pushTitleFor(notification.agent, notification.kind),
      body: notification.title,
      threadId: notification.session,
      data: { agent: notification.agent, session: notification.session, kind: notification.kind },
    })
  })

  // The coordinator delivers into agent sessions but must not import the agent
  // (a cycle). app.ts is the one place that imports both, so it hands over a
  // dispatcher here.
  jobs.setDispatcher((session, body, kind) => {
    deliverToAgentSession(session, body, kind).catch((error) => {
      console.error(`[jobs] dispatch to ${session} failed:`, error)
      const identity = parseSessionKey(session)
      if (identity?.jobId === undefined) return
      // A transient admission failure (the model provider was briefly down when
      // the job was kicked off) re-drives rather than failing — the same
      // treatment a transient *turn* failure gets in the recovery tap. Anything
      // else a retry cannot fix fails the job restartably. The recovery tap owns
      // the retry ceiling: `recover` is a no-op once the job is terminal.
      const { tenantId, jobId } = identity
      const reason = describeError(error)
      const job = jobs.get(tenantId, jobId)
      if (isTransientDispatchError(error) && job && job.attempts < MAX_RECOVERY_ATTEMPTS) {
        setTimeout(() => jobs.recover(tenantId, jobId, reason), backoffMs(job.attempts)).unref()
      } else {
        jobs.fail(tenantId, jobId, reason)
      }
    })
  })

  // The same delivery for a message that is not a job (an operator's answer to
  // an attention item). A failure here is logged, not fatal: the originating
  // request is already closed.
  setSessionDeliver((session, body, kind) => {
    deliverToAgentSession(session, body, kind).catch((error) => {
      console.error(`[messaging] delivery to ${session} failed:`, error)
    })
  })

  // A blocking agent-to-agent question: dispatch into the counterpart's thread
  // session and await the settled reply. init() gives a handle whose read()
  // resolves when that turn settles — the durable primitive ask_agent needs.
  setAskAgentDeliver(async (threadSession, message) => {
    const handle = init(StaffAgent, { id: threadSession })
    const receipt = await handle.dispatch({ message: { kind: "user", body: message } })
    const reply = await handle.read(receipt)
    return { text: reply.text }
  })

  // The scheduler owns the schedule timers and the deadline-sweep interval.
  // `start()` is idempotent. Guarded so tests and dev runs that must not open
  // background jobs can turn it off.
  if (process.env.STAFFROOM_SCHEDULER !== "off") {
    // Recover jobs stuck in `assigned` exactly once, on the first sweep. It runs
    // here — not inline above — because app.ts evaluates before Flue configures
    // the runtime, so a boot-time `dispatch()` would throw; the sweep timer
    // fires well after configuration, making it the first safe moment.
    let assignedRecovered = false
    getScheduler(() => {
      if (!assignedRecovered) {
        assignedRecovered = true
        const revived = jobs.redispatchAssigned()
        if (revived.length > 0) {
          console.log(
            `[jobs] re-dispatched ${revived.length} stuck assigned job(s): ${revived.join(", ")}`,
          )
        }
      }
      const escalated = jobs.sweepDeadlines()
      if (escalated.length > 0) console.log(`[jobs] escalated overdue: ${escalated.join(", ")}`)
    }).start()
  }
}

/** The push title — who needs you and why, one line above the raise's own. */
function pushTitleFor(agent: string, kind: string): string {
  const reason: Record<string, string> = {
    question: "has a question",
    decision: "needs a decision",
    review: "wants a review",
    failure: "is stuck",
    approval: "needs approval",
  }
  return `${agent} ${reason[kind] ?? "needs you"}`
}

function deliverToAgentSession(session: string, body: string, kind: "signal" | "user") {
  const message =
    kind === "user"
      ? ({ kind: "user", body } as const)
      : ({ kind: "signal", type: "job", body } as const)
  return dispatch(StaffAgent, { id: session, message })
}

// The once-only work is serialized on `globalThis` (which survives Vite's module
// re-evaluation in the same process); the agent wiring then runs on every
// evaluation, binding the coordinator to this evaluation's registered StaffAgent.
const runtime = globalThis as typeof globalThis & { __staffroomBoot?: Promise<void> }
await (runtime.__staffroomBoot ??= bootOnce())
wireAgent()

export default createApp({
  auth: getAuth(),
  agentRouter: createAgentRouter(StaffAgent),
  uiDir: process.env.STAFFROOM_UI_DIR,
})
