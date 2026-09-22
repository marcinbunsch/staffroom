# Events and schedules — a primer

The event bus, the matcher, the two guards that stop a cascade, and schedules as
the first thing built on top. Lives in `protocol/events.ts`,
`protocol/schedules.ts`, and `coordinator/{event-bus,schedules-store,scheduler}.ts`.

## The one idea

**An event that matches a subscription opens a job.** That is the whole bus. Not
a chat message, not a notification, not a new kind of thing to inspect — a job.
And a job (see `jobs.md`) already has a private session, a timeline, caps, a
deadline, operator inspection and cost attribution. So "react to an event" costs
no new machinery: a reaction is ordinary job history, shows up on the board like
any other work, and is answered by the same audit query as everything else.

Everything that initiates work is a **producer** on this bus. The bus does not
care what the producer is; it takes an envelope and opens jobs for the
subscriptions that match. (`EventBus.publish` in `event-bus.ts`.)

## Why schedules come first

Schedules are the first producer, and deliberately so. A scheduled run is the
one we understand best — it fires on a clock, it has an obvious owner, it is easy
to reason about. So it is the honest test of the abstraction: **if the bus cannot
express a schedule cleanly, the design is wrong**, and we would rather find that
out before files, agent-to-agent, or anything else leans on it. Schedules
building cleanly on the bus is a validation, not a coincidence.

## A schedule is one row

A schedule holds two things — _when_ and _what_ — and it is **one row**
(`Schedule` in `protocol/schedules.ts`). From that single row **both a timer and a
subscription derive**:

- the **timer** (the _when_): a `Timing`, either `cron`, `interval`, or `once`;
- the **subscription** (the _what_): match `schedule.fired`, open a job for this
  `agent` with this `instruction`.

A schedule **runs as a routine** — recurring, on a `cron` or an `interval` — or
**runs once**, a one-off at a specific time (`once`). The recurring variants fire
forever until disabled; a one-off fires a single time and is then **marked
completed** (see below). There is **no producer table and no subscription
table**. A schedule's subscription is _derived_ from the row every time the bus
asks, never stored (`SchedulesStore.subscriptions` and `scheduleSubscription`,
both in `schedules-store.ts`). That derivation lives next to the data it reads,
so there is exactly one place that knows a schedule is also a subscription — and
the Schedules screen, the CLI and the protocol all see a schedule as one editable
thing.

Because the subscription is derived, disabling a schedule removes its
subscription with nothing else to also disable — there is no separate producer
left running. (Proven live: an off schedule simply drops out of
`subscriptions()`, which filters on `enabled`.)

## The one-off, and completion

A one-off is a schedule whose `Timing` is `once` — an instant, not a cadence. It
exists so an agent asked to "run this in three hours" or "check X at 3pm" has a
clean primitive, rather than the create-a-schedule-then-delete-it dance.

When a one-off fires it is **done**: the scheduler marks it completed
(`SchedulesStore.markCompleted`, which sets `completedAt` and, like `markFired`,
leaves `updatedAt` alone — firing is not an edit). A completed schedule is
**kept as a record** — it stays in the list, shown as done, the way a finished
to-do does — but `subscriptions()` filters out anything completed, so it **drops
off the bus and never fires again**. No agent cleanup, no orphaned producer.

The scheduler arms a one-off with a single-shot timer at its `at`. If the process
was down through that time, the one-off can never fire on the clock again, so it
is treated like a missed run: `catchUp` fires it once now, otherwise it is
skipped loudly — and **either way it is marked completed**, because a past
instant is spent.

## The indirection that is the rule

Here is the part that looks like a detour and is actually the point. When a
schedule's clock ticks, the scheduler does **not** open a job. It **publishes
`schedule.fired`** (`Scheduler.#fire` in `scheduler.ts`), and the **bus** matches
the schedule's derived subscription and opens the job.

The scheduler could open the job directly. It deliberately does not, because
that would make it a free-standing schedule producer — a second path to work
that bypasses the bus. Routing the tick back through `publish` means **every
event in the system flows through one mechanism**. The rule "no free-standing
schedule producers" is not a comment; it is this indirection. The scheduler owns
a clock; the bus owns the reaction; neither reaches into the other's job.

`scheduleSource(id)` (`= schedule:<id>`) is the seam: the scheduler stamps it as
the event's `source`, and the derived subscription matches on exactly that, so a
tick only wakes its own schedule.

## The matcher

`matches(envelope, match)` in `event-bus.ts` is the core, and it is small on
purpose. Type equality first, then every `where` key must equal the
corresponding field:

```
type === match.type          // required
every where key === field    // optional, exact
```

`where` reads from a **flat view** of the envelope — its `source` merged over
its `payload` — so a top-level field like `source` and a payload field like
`visibility` are matched the same way, with no path syntax to learn.

The matcher is **equality only** (`MatchValue` is a string, number or boolean;
`EventMatch` is a type plus an optional flat `where`). No operators, no query
language, no ranges. This is the same posture as everything else in the system:
it covers every case in the plan, **indexes trivially**, and — the load-bearing
property — **cannot be written wrong in a way that silently matches
everything**. A too-broad matcher is a bug you never get to write here.

## Loop protection: two guards, one number

An event can open a job, whose agent can publish an event, which can open another
job. Two independent guards keep that cascade finite (both in `event-bus.ts`,
constants in `events.ts`):

- **The causation chain (cycle guard).** Every envelope carries a `chain`: the
  subscription ids that produced it, in order. A match is refused the instant its
  subscription id is already in the chain. That catches a cycle **exactly** —
  there is no threshold to tune — and the chain doubles as the answer to "why did
  this job open." Shared with agent-to-agent calls, so one cascade is one causal
  path.
- **The depth cap.** `MAX_EVENT_DEPTH = 5`. This catches the other failure:
  runaway fan-out that never repeats a single subscription, so the cycle guard
  never trips. Past the cap the **whole event** is dropped (not each match) —
  nothing below that depth is legitimate.

The depth cap is `5` on purpose: the same number as the job tree's `MAX_DEPTH`
(see `jobs.md`). One cascade crossing subscriptions, agent calls and child jobs
is **one number to reason about**, not three.

## Scope: tenant by default, org by exception

A subscription only sees **its own tenant's** events; the bus filters on
`tenantId` before it even runs the matcher (`EventBus.#matching`). That is the
default and the safe case.

`org` is the **short, named, auditable exception** a producer opts into by
setting `scope: "org"` on the envelope. An org-scoped event is visible to any
tenant's matching subscription — the intended example is a file shared to the
org (see `files.md`). Scope is a two-value enum (`EventScope`), not a free-form
audience, precisely so the exception stays short and inspectable.

## The cursor and catch-up

`lastFiredAt` is the schedule's **subscription cursor** — what a durable bus calls
a per-subscriber position. It is the field that answers "did we miss a run while
the process was down," so **catch-up is a cursor comparison**, nothing more.

On start the scheduler computes each recurring schedule's previous scheduled time
and compares it to `lastFiredAt` (`Scheduler.#catchUpIfMissed`). If a run fell in
the gap while the process was down, the schedule either **fires once** (`catchUp`
true) or is **skipped loudly** with a log line (`catchUp` false, the default). A
schedule that has never fired (`lastFiredAt` null) is never caught up — there is
no missed run to replay. `markFired` advances the cursor after every fire and
deliberately leaves `updatedAt` alone, so firing is not an edit. (A one-off has no
cursor to advance — it sets `completedAt` instead; see above.)

## The scheduler also owns the sweep

The scheduler carries one extra job that is not about schedules at all: the
**deadline-sweep interval** (`start` takes `sweepEveryMs`, defaulting to 30s, and
calls an injected `onSweep`). It lives here because the scheduler is the one
component that already has a **start / reload / dispose timer lifecycle** — a
second timer belongs with the first rather than in a class invented to hold it.
The sweep logic itself (`sweepDeadlines`) is the jobs coordinator's; the
scheduler only owns the clock that calls it. (See `jobs.md`.)

Every schedule change through `schedule-routes.ts` calls `reloadScheduler()`, which
re-reads the schedules and reschedules — so a new or edited schedule takes effect
**without a restart**. Reload never sweeps, so the routes hand it a no-op
`onSweep`.

## Wiring

The process-wide bus is built with its subscription sources as functions
(`SubscriptionSource = () => Subscription[]`), and it **asks every source on each
publish** rather than keeping its own registry — so there is never a cached copy
to fall out of sync. Today the one source is the schedules store's derived
subscriptions; `getEventBus()` in `event-bus.ts` is where a second source (a
stored-subscription store) would join. The bus reaches the jobs coordinator to
open jobs, and the reaction is stamped with the subscription as originator, so a
completion that reports lands in the agent's own main chat. A schedule's jobs are
**silent by default** (`report_mode: on_request`): the schedule runs quietly and
only surfaces to the main chat when its assignee closes with `report: true`,
having found something worth reporting. A schedule that should speak every run — a
daily digest — is set to `always` (in the schedule form, the `schedule_set` tool's
`report_when`, or the API). The mode rides the derived `Subscription` into
`#react`, which passes it to the job; see the [jobs](jobs.md) primer for how
`close()` gates the announcement.

## What files added, and the loop closing

Schedules gave the bus its first event type, `schedule.fired`. Files gave it the
next two — `file.created` (tenant-scoped) and `file.shared` (org-scoped) — and in
doing so exercised both the payload-field matcher (`where: { visibility: "org" }`)
and the org-scope exception on a real producer that is not a schedule. That is the
abstraction closing the loop: a second, differently-shaped producer dropped onto
the same bus with no new mechanism. See `files.md`.

## Where the record lives

Schedule rows are in `staffroom.db`. An event envelope is **not persisted** as its
own thing — its consequence is a job, and the job's row, timeline and audit
entries are the durable record. "Why did this job open" is answered by the job's
originator and the causation `chain` it was opened with, not by a separate event
log.
