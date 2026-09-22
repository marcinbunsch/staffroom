# Jobs — a primer

What a job is, the state machine, job sessions, the tree, deadlines, and the one
seam that keeps the coordinator free of an agent import. Lives in
`coordinator/jobs.ts`, `tools/job-tools.ts`, and `job-routes.ts`.

## What a job is, and why

When a request is more than a quick answer, an agent opens a job. A job is:

- an **instruction** and a **title**, given at creation;
- an **assignee** (a staff member) and an **originator** (who to report back to);
- a **private Flue session** it runs in;
- a **timeline** of every transition and note, so its whole story is on the
  record;
- optional **caps** and a **deadline**;
- **cost**, attributed through the audit log by the job's session.

A job can be handed between agents and outlives the conversation that opened it.
That is the whole reason it is not "just a chat message": a chat is a place you
talk, a job is a piece of work with its own record and its own clock.

Two other things in the system are jobs under the hood, deliberately: a **bus
subscription that matches** opens a job (see `events-and-schedules.md`), and a
**schedule firing** opens a job. Making them jobs means a reaction gets
a session, a timeline, caps and cost attribution for free, and shows up on the
board like any other work.

## The state machine

Seven states (`JobState` in `protocol/jobs.ts`):

| State              | Meaning                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `assigned`         | Opened and dispatched, not yet started by its assignee.              |
| `working`          | The assignee's session is working it.                                |
| `waiting_children` | Blocked on an awaited child; returns to `working` when it closes.    |
| `paused`           | The operator is holding it. Excluded from the deadline sweep.        |
| `done`             | Closed with a summary. Terminal.                                     |
| `failed`           | Infrastructure or a missed deadline ended it. Terminal, restartable. |
| `cancelled`        | The operator hard-stopped it. Terminal.                              |

`TERMINAL_STATES` is `done | failed | cancelled`. The only exit from `working`
under the agent's own control is `close`, which writes the summary and — unless
suppressed — notifies the originator. Everything else is an operator action or an
infrastructure event.

**Reporting is a job property, not a fixed rule.** Each job carries a
`report_mode` (migration `028`): `always` announces the closing summary into the
originator's chat (the default for a job a person opened — they asked, so they
hear back); `on_request` stays silent unless the assignee calls `job_close` with
`report: true`. Either way the summary and terminal state are recorded and any
parent is still resumed — only the chat announcement is gated (`close()` in
`coordinator/jobs.ts`). This is what lets a "watch for X" schedule run quietly and
speak up only when it finds something; the assignee is told which mode it is in
via the digest. Schedule-opened jobs default to `on_request`; see the
[events-and-schedules](events-and-schedules.md) primer.

### The relationship to WS-HumanTask

This shape is WS-HumanTask's, by **convergence, not adoption** — and the
distinction is deliberate.

The states map onto the standard's: `assigned`≈Reserved, `working`≈InProgress,
`paused`≈Suspended, `done`≈Completed, `failed`≈Failed/Error, `cancelled`≈Exited.
And the **deadline that escalates when crossed** is the one transition the
standard has that a naive job engine lacks — we took exactly that (below).

What we deliberately did **not** take:

- **The uppercase state names.** They are the ceremony; our lowercase words are
  clearer to someone reading `jobs.ts`, and nothing speaks the WS-HumanTask wire
  protocol to us, so matching the labels would buy nothing and falsely signal
  conformance.
- **Release / return-to-pool.** The standard separates _release_ from
  _complete_/_fail_, but release only pays off with a _claim_ mechanism and a
  work pool. Every job here has an assignee, dispatched directly — no pool, so
  release would be machinery without a customer. Revisit only if agents ever
  _pull_ work.
- **A `Ready`/`Created` state.** There is no pool to be available _in_; a job is
  born `assigned`.

And one state is **ours, not the standard's**: `waiting_children`, for the job
tree, which WS-HumanTask has no notion of.

## Job sessions

A job runs in a Flue session keyed `tenant:assignee__job-<id>`
(`sessionOf`, and `composeSessionKey` in `protocol/identity.ts`). Two
consequences:

- The **tenant rides in the key**, so a job claimed from Flue's poll loop after a
  restart resolves its owner with nothing threaded through — the reason the whole
  tenancy design works (see `tenancy.md`).
- On **handoff the assignee changes**, so the session id changes, but the audit
  `job_id` column stays constant — which is why per-job cost is a `GROUP BY
job_id` and not a column on the job row.

`StaffAgent` marks the job `working` on the first turn of its session
(`useAgentStart`) and steers the agent toward `job_close`.

## The tree and its caps

Jobs form a tree: `job_spawn` opens a child under the current job. A parent that
needs its children's results waits for them one of two ways:

- **`job_await`** — the direct, inline join. The parent spawns its children, then
  calls `job_await`, which **blocks the turn** until every listed child (or all
  open children by default) is terminal and returns their summaries. It watches
  the coordinator's change pulse and has a timeout fail-safe, so a stuck child
  cannot hang the parent forever (`JobsCoordinator.waitForJobs`). This exists
  because the reactive path alone let a parent close its summary before a sibling
  came back.
- **`awaited` on `job_spawn`** — the reactive path. An awaited child moves the
  parent to `waiting_children`; the parent returns to `working` only once its
  **last** awaited child settles (`#resumeParentIfReady`) — a child that closes,
  fails, or is cancelled all count, so a failed child can never strand the
  parent. Waking on the first child (the old behaviour) is the exact bug
  `job_await` and this fix close.

Two caps guard against runaway work (`JobCapError`):

- `MAX_DEPTH = 5` — the tree cannot nest deeper. Shared in spirit with the bus's
  depth cap: one cascade crossing subscriptions, agent calls and child jobs is
  one number to reason about.
- `MAX_OPEN_PER_AGENT = 10` — an agent cannot hold more than ten non-terminal
  jobs. Counted **per tenant**, so one tenant cannot exhaust another.

A tool call that hits a cap returns the reason to the model rather than throwing,
so the agent can react.

## Deadlines and the sweep

A job may carry `deadline_at`, `on_overrun` (`notify | fail`) and `escalated_at`
— three columns from the **first migration** (`003-jobs`), not a later `ALTER`,
because M7's confirm-gates cancel a pending approval when a job's deadline
expires, so the column is a dependency rather than a nicety.

`sweepDeadlines(now)` escalates every job past its deadline exactly once (the
`escalated_at` timestamp is the guard). It is pure of the clock — a test passes
its own `now` — and the scheduler owns the timer that calls it, being the one
component with a start/reload/dispose lifecycle. `paused` jobs are excluded on
purpose: a paused job is one the operator is already holding, and escalating it
would nag the person who pressed pause. Per the deadline design's own leanings we
ship **notify and fail only** (no reassign) and **escalate once** (no re-notify).

## The dispatcher seam

The coordinator must deliver messages into agent sessions — a fresh job's digest,
a resume nudge, an operator's steer — but it must **not import the agent**, which
would be a cycle (agent → tools → coordinator → agent). So `app.ts`, the one
module that imports everything, hands the coordinator a `dispatch` function at
boot via `setDispatcher`. A `setTerminalListener` hook is the same idea: a job
going terminal cancels its pending confirm-gate approvals, wired from `app.ts` to
the attention store rather than imported.

## The toolset

`attachJobTools` (in `tools/job-tools.ts`) gives every agent `job_create`,
`list_jobs`, `get_job`; an agent already inside a job session also gets the
working set bound to that job: `job_note`, `job_handoff`, `job_spawn`,
`job_await`, `job_close`, `job_read`. Each is bound with the tenant at render
time.

## Operator controls

`job-routes.ts` exposes the board (`GET /api/jobs`), one job's detail with its
timeline and children, and the state transitions only the operator makes:
`pause`, `resume`, `restart` (a failed job only), and `steer` (post a message
into the session). Agents open and close; operators inspect and intervene.

The board list is flat — it returns every job, children included. The UI is
meant to render it nested: **top-level jobs on the board** (`parentId === null`),
a job's **children on its own detail page** (`GET /api/jobs/:id` already returns
`children`), and a spawned child still visible in a **"currently running"** view
of all non-terminal jobs. That is a UI-step decision recorded in the plan (M13);
the data model needs no change to support it.

## Where the record lives

The job row and its `job_entries` timeline are in `staffroom.db`. Every model
turn and tool call inside a job session also lands in `audit.db`, attributed by
`job_id` — so "what did this job cost" and "what did it actually do" are answered
by the audit, and the timeline holds the human-readable story.
