# Audit and cost — a primer

The append-only record of what every agent did and what it cost, and the spend
page built on it. Read this before you touch instrumentation, pricing, or
anything that wants to know "what did this cost."

## The one-paragraph version

One `observe()` subscriber taps Flue's own event stream and records every agent
turn and tool call as a row in an append-only log. Model turns carry cost —
tokens in and out, cache reads and writes, the dollar total — as **columns**, not
a JSON blob, so the spend page is a `GROUP BY`. Every row is attributed to a
tenant by the session key, never by Flue's internal conversation id, and a row
that resolves to no tenant is dropped. The log lives in its own database file so
the busiest writer in the system never contends with better-auth for a lock.

## The load-bearing decision: this lands first

Cost you did not record cannot be backfilled. A blob can be reshaped into columns
after the fact; a dollar figure that was never captured is gone. So the audit
spine arrives **before** jobs, tools, or anything else that spends — this must be
right from day one, because day two is already too late for the rows written on
day one. The schema in `packages/protocol/src/audit.ts` and the migration in
`coordinator/audit-schema.ts` open on this premise.

## Central instrumentation, not scattered hooks

The whole tap is one subscriber: `startFlueAudit` in
`coordinator/flue-audit.ts`. It calls Flue's `observe()` once and, for every
event, maps the ones worth keeping to an `AuditEventInput` and records them.

The alternative was to wrap each tool and each turn with its own logging. That is
a thing you can forget to add — a new tool ships uninstrumented and nobody
notices until the spend page is wrong. A subscriber on the event stream is not
something you forget: a tool that runs at all emits events, and the tap sees them
all. `toAuditEvent` is the entire mapping, exported so a test can prove it
rather than trusting a comment. Auditing also never breaks the run it observes —
the subscriber swallows its own errors and warns.

Only a handful of Flue's wide event union matters. `agent_start` and `agent_end`
bracket a turn; `turn` is a priced model call; `tool` is a completed tool call.
Everything else — streaming deltas, message fragments, turn requests — returns
`undefined` and is skipped.

## Attribution is by the session key, never the conversation id

Every event Flue emits carries an `instanceId`, which is the caller-chosen
session key (`alice:devops`, `alice:devops__job-42`). That key carries the tenant
and, for a job session, the job — so `parseSessionKey` recovers both. Flue also
carries a `conversationId`, its own generated id, which belongs to no tenant and
means nothing to us.

Getting these two backwards was one of the prototype's hard-won lessons, so it is
a test (`flue-audit.test.ts`, "takes the tenant from the session key, not from
Flue's conversation id") and not a comment. And an event with no resolvable
session key is **dropped**: a row no tenant-scoped read could ever see is not
worth writing. See `tenancy.md` for why the tenant rides in the key and nowhere
else.

## Cost is read from Flue, not computed here

Flue prices every turn against the model's own cost table — `PromptUsage` breaks
out input, output, cache-read and cache-write, and gives a dollar total. The tap
lifts those numbers straight into columns. There is no local price list here to
go stale: the number is **read**, not recomputed. The credential that paid rides
in the turn's `request.providerId` — the provider id _is_ the credential (see
`providers/registry.ts`), so the suffix after the upstream name tells an org key
from a personal one. When a turn reports no usage the tap records zeros rather
than nothing, so the row still exists.

### The usage columns

Every model turn records these, straight off Flue's `response.usage`. Non-model
events record `NO_USAGE` — all zeros and nulls.

| Column          | Holds                                                     |
| --------------- | --------------------------------------------------------- |
| `model`         | The model that answered (response model, else requested). |
| `credential_id` | Which credential paid — an org key vs. a personal one.    |
| `tokens_in`     | Prompt tokens consumed.                                   |
| `tokens_out`    | Completion tokens produced.                               |
| `cache_read`    | Tokens served from the prompt cache.                      |
| `cache_write`   | Tokens written to the prompt cache.                       |
| `cost_total`    | The dollar total Flue priced for the turn.                |

These sit alongside `tenant_id`, `agent`, `session`, `job_id`, `type`, `ts` and a
`seq` — insertion order, and the only ordering the log trusts. Anything not worth
a column (tool names, durations, error and finish flags) goes in a JSON
`payload`.

## Pairing a tool with its arguments

A tool call is two Flue events: the arguments arrive with `tool_start`, the
result with `tool`. A single audit row wants both, so the subscriber has to hold
the arguments in between. `rememberToolArguments` stashes them by `toolCallId` in
a bounded `pendingToolArguments` map; `takeToolArguments` retrieves and clears
them when the `tool` event lands.

Without this the log recorded the _output_ of every shell command an agent ran
and never the command itself — the least useful half. The map is capped at 256
entries and evicts oldest-first, so a tool that never reaches its terminal event
cannot leak arguments forever. Tool input is truncated at 600 characters (longer
than a result summary, because a shell command is the point of the record and
you do not want the end of the pipeline cut off).

## Its own database

The log lives in `audit.db`, opened lazily by `getAuditDatabase`, separate from
`staffroom.db`. Two reasons. It is append-only and grows without bound — every
turn and every tool call — so it wants to be rotated and archived without
touching operational data. And it is the busiest writer in the system: keeping it
out of the file better-auth also writes to means the two can never contend for a
write lock, which matters more than usual because the driver
(`better-sqlite3`) is synchronous and a lock wait parks the whole process.

Nothing joins across the two files, and nothing needs to — every question the
spend page asks is answered by columns on the audit row itself.

## The spend page

`AuditLog` in `coordinator/audit.ts` is the whole read surface: `record`,
`query`, and `spend`. Reads are always tenant-scoped. `query` returns the newest
N events matching a filter, then flips them oldest-first so the log reads
top-to-bottom like a transcript.

`spend(tenantId, dimension, range)` totals a tenant's cost grouped by a
dimension — `agent`, `model`, `session`, or `credential` — over an optional date
range. Each is a column, so each is a `GROUP BY` with no derived store to drift
out of sync. Only `model.turn` rows contribute, so a zero-cost `agent.start`
never inflates the turn count. Per-job cost is a `GROUP BY job_id`: recall from
`jobs.md` that a handoff changes the session id but not the job id, so grouping by
session would split one job's spend and grouping by job id keeps it whole.

`spendAcrossTenants` is the one admin view and the **only** cross-tenant read in
the class — named exactly so, so the set of cross-tenant reads stays small and
greppable. It groups by tenant instead. Nobody sees a colleague's job titles or
session keys through the ordinary spend path.

## The honest gap

Only **model turns** are priced. A `tool.call` row is recorded — you can see that
a Firecrawl scrape or a shell command ran — but its cost is zero. A metered
external API (Firecrawl, and the other integrations in `tools-and-credentials.md`)
costs real money that will **not** appear on the spend page. Know that before you
trust the page as the whole bill; it is the model bill, complete and exact, plus a
record of everything else that happened without a price on it.

## Verified live

A real turn produced `agent.start` / `model.turn` / `agent.end` rows attributed
to the right tenant, with real token counts and a cost priced by Flue — not a
computed estimate. A chief→devops job showed its per-job cost as a single
`GROUP BY job_id`, unbroken across the handoff. The mapping, the tenant
attribution, and the tool-argument pairing each have their own tests in
`packages/server/tests/coordinator/`.

## Where to go next

`tenancy.md` for why the tenant lives in the session key, then `jobs.md` for the
job id the spend page groups on.
