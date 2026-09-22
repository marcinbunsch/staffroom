# Staff v2 — a plan

A fresh repository, built from the ground up, with the prototype available for
reference in prototype folder. Decided 2026-09-02.

> **Kept as history.** This is the founding plan, written before the build;
> where it disagrees with the code, the code won. The `prototype` folder it
> mentions is a local checkout that is not part of this repository and is not
> public — see the note in [`plan-of-attack.md`](plan-of-attack.md).

Three parts: **what we decided and why**, **the schemas**, **the build order**.

## What stays

- **Flue.** It carries durable execution, the conversation store, the tool
  model, and — as this plan discovered — the skill system too.
- **The design.** The UI is good. Nothing here changes how it looks.
- **The concepts.** Jobs, routines, artifacts, the audit log.
- **Watching an agent turn a prompt into a result.** Every decision that touched
  the request path was made to keep that intact.

## What the prototype is for

**A reference, plus a source for code with no tenant dimension.** Lift verbatim:
identity parsing, the Codex provider, the Docker sandbox, individual tool
implementations (Firecrawl, Gmail, Calendar, the MCP gateway). Write fresh:
anything that touches a store, a session key, a job, or the request pipeline —
because the tenant seam has to be in those from the first commit, not bolted on.

The primers are worth reading before rewriting the thing they describe, and
their prose is worth stealing.

---

# Part 1 — Decisions

## 1. Multi-tenancy

**Tenant is a user.** `tenant_id` is a [better-auth](https://better-auth.com)
user id. One organization holds the team, and owns the shared tool catalog, the
shared file space, and the admin role. Shared core, own agents — exactly the ask.

### One process, one flue.db

Two findings in Flue's source decide this.

`flue/packages/runtime/src/node/start.ts:7`:

> One process holds at most one Flue runtime (the runtime keeps module-scoped
> registries — see `configureFlueRuntime`), so `start()` refuses to run where a
> runtime is already configured.

So one `flue.db` per person means one process per person. `start()` throws;
it's a constraint, not an oversight.

And decisively: `listRunnableSubmissions`, `listRunningSubmissions` and
`listExpiredSubmissions` in `sql-agent-execution-store.ts` scan the whole
submission table with **no session filter**. Point two processes at one
`flue.db` and one tenant's process claims and runs another's submissions —
`claimSubmission` is an atomic conditional `UPDATE … RETURNING`, so it succeeds
cleanly and then executes against the wrong roster. Silently wrong.

Shared store and multi-process are therefore mutually exclusive. **We take the
shared store**: one process, one runtime, one `flue.db`, session keys namespaced
by tenant (`alice:devops`, `alice:devops__job-42`).

The costs, recorded so they aren't rediscovered:

- **Draining is all-or-nothing.** `pause()` and `waitForIdle()` are
  runtime-global, so shipping a change pauses everyone's turns.
- **One blast radius.** A corrupt file hits the team; deleting a leaver's data
  is a scan, not `rm`.
- **One crash domain**, one event loop.
- `hasUnsettledSubmissions()` is global, so "is the runtime idle" is a team-wide
  answer.

**This is reversible and additive.** Moving to a process per tenant later means
writing a supervisor and a reverse proxy. No store code is rewritten, because
each process would then own its own `flue.db` and the unfiltered claim queries
stop mattering.

**Rejected: a fan-out `PersistenceAdapter`.** Flue's `PersistenceAdapter`
(`agent-execution-store.ts:420`) is a genuine extension point — adapters ship
for postgres, mysql, mongodb, libsql and redis, with a public contract-test
suite. A custom adapter routing on the tenant prefix of `session_key` to
per-tenant files would give file isolation in one process. Rejected because it
takes on the hardest correctness burden in the system — leases, atomic claims,
settlement obligations — to buy the _weakest_ isolation: no crash domain, no
independent restart, and a broken `sequence` ordering across tenants. If file
isolation is worth having, separate processes get it plus everything else.

### One staff.db, tenant column

Every operational table carries `tenant_id`. Cross-tenant queries — the admin
spend view, the shared file space — stay a single `SELECT`.

The failure mode is a missing `WHERE tenant_id = ?`. It doesn't crash; it shows
a colleague's jobs.

**The guard:** a shared `defineTenantIsolationTests(makeStore)` helper —
mirroring Flue's own `test-utils/define-store-contract-tests` — that writes as
tenant A, writes as tenant B, and asserts every read, list, update and delete
from A never sees B. Every store imports it in its own test file. A store
without it is visible in review.

### Where the tenant comes from

**The namespaced session key, never ambient context.** Flue claims submissions
from a poll loop, so an `AsyncLocalStorage` tenant would be empty exactly where
it matters — a job resumed after a restart.

This extends an idiom the prototype already has: `StaffAgent` parses its session
id and binds the caller's identity into its tools at render time, because Flue
won't tell a tool who called it. That binding is `{ tenantId, agentId }` from
the first commit, and the tenant flows everywhere the agent identity does.

### What is shared

| Thing                                            | Scope                            |
| ------------------------------------------------ | -------------------------------- |
| Tool catalog, MCP registrations                  | Org, admin-configured            |
| Credentials                                      | Per tool: org secret or per user |
| Roster, jobs, routines, chats, memory, attention | Per user                         |
| Files                                            | Per user, promotable to org      |
| Skills                                           | Per agent, plus an org directory |
| Audit                                            | Per user; admins see across      |

A catalog entry declares whether its credential is **shared** (an org Firecrawl
key) or **per-user** (a Gmail connection). A per-user tool is not offered to an
agent whose owner hasn't connected — the agent never sees a tool it could only
fail with.

## 2. Security

**better-auth** for accounts, sessions, roles (`admin` plugin) and CLI tokens
(`apiKey` plugin). Auth resolves an identity rather than comparing a secret.

**Secrets encrypted at rest.** One file holds several colleagues' OAuth tokens
and API keys. AES-GCM per record, key from `STAFF_SECRET_KEY`. The honest limit:
this protects a stolen backup, a synced folder, a disk image. It does not
protect against someone who already has the process environment.

**Open:** better-auth's direct database support targets `better-sqlite3` and
Kysely; this repo uses `node:sqlite`. Confirm the adapter before it is
load-bearing — resolve this in the walking skeleton, since everything depends
on it.

## 3. Prompt injection

**Reframed.** "Prompt-injection hardened" isn't reachable as a property of
prompts. What's reachable is that a compromised turn can't do lasting damage.

**Confirm-gates on outbound and irreversible tools** — sending mail, posting to
Slack, deleting, spending, writing outside the sandbox. The model can be talked
into anything; the operator sees "send mail to attacker@evil.com" and doesn't
approve.

### The gate suspends; it does not block

The obvious design — the tool call blocks until a human answers — is wrong, and
Flue's constants say why (`agent-execution-store.ts:19-23`):

```
DURABILITY_DEFAULT_MAX_ATTEMPTS = 10
DURABILITY_DEFAULT_TIMEOUT_MS   = 3_600_000   // 1 hour
LEASE_DURATION_MS               = 30_000
```

A claimed submission gets `timeout_at = now + 1 hour`. A call blocked overnight
trips that timeout, is reclaimed, and **retried up to ten times** — re-running
the turn each time, re-doing whatever it already did.

So the flow is:

1. The agent calls a gated tool. The wrapper finds no approval, raises an
   attention request, and **returns immediately** — "this needs approval". The
   turn ends cleanly and the submission settles. No lease is held.
2. The job moves to a waiting state, visible on the board. Nothing is running,
   nothing is burning tokens.
3. The operator answers. The jobs engine dispatches a **new turn** into the same
   session: "Your request to send mail to X was approved — proceed." The
   session history is intact, so the model sees its own earlier attempt.
4. A denial is the same mechanism with a reason the model can adapt to.
5. The job's deadline still bounds it (see [`job-deadlines.md`](job-deadlines.md)).
   If it expires first, the job fails and the pending request is cancelled — a
   late approval never wakes a dead job.

So it is **not a resumed tool call; it is a resumed job, as a new turn.** That
is the only shape that survives an overnight wait.

**An approval issues a one-shot token** bound to `(job, tool, argumentsHash)`.
Without it the re-issued call hits the gate again and the operator approves
forever.

The same mechanism works with no job: a gated tool in a plain chat ends the turn
asking, and the answer dispatches a new turn into that conversation.

### Where the gate intercepts

**In the wrapper bound at render time** — the same seam that already binds
identity into tools. A gated catalog entry's `run` is wrapped: look for a
matching one-shot approval, call through if present, otherwise raise and
suspend. Because it wraps the descriptor rather than the implementation, local
tools, MCP-gateway tools and plugin tools are all gated identically, and the
tool itself knows nothing about gating.

### Recorded, not built

- **Provenance-tagged untrusted content** — mail, Slack and web results wrapped
  so the model can see they're data, not instruction. Cheap, and a request to
  the model rather than a constraint on it.
- **Trust-separated agents** — a reader of untrusted sources gets no outbound
  tools and reports to an agent that has them.

Two decisions elsewhere belong to item 3: only a human promotes a file to shared
(§4), and an agent-written skill may not set `allowedTools` (§6).

## 4. Files

One concept from the start. A file has metadata in `staff.db` and bytes on disk
at `files/<id>`. A `source` field records where it came from — an operator
upload, an agent, a job — and optional links say which message, agent or job it
belongs to. There is no separate artifact store and no text-only limitation.

All files are deletable; the audit log makes that accountable.

**Sharing is a field, not a copy.** `visibility: private | org`; reads are
`tenant_id = me OR visibility = org`. One file, one version, and un-sharing is a
flip. The owner stays the owner and is the only one who can delete.

**Only a human promotes.** An agent producing a team report cannot publish it
itself. This costs some unattended convenience and closes a leak path.

## 5. The event bus

Flue offers nothing to reuse: `observe()` is a tap on agent activity — turns and
tool calls — not a general bus, and the dispatch queue is internal.

**An event that matches a subscription opens a job.** Not a chat message, not a
new concept. A job already has a private session, a timeline, a deadline, caps,
operator inspection and cost attribution, and it keeps reactions out of the
chats you read. It also puts an agent acting on its own onto the board, which
matters more as agents become reactive.

### Routines are subscriptions

A routine holds two things: **when** (`schedule`, `catchUp`) and **what**
(`agent`, `instruction`). The **producer** owns the clock and publishes
`schedule.fired`. The **subscription** owns the reaction — match that event,
open a job for that agent with that instruction.

**Both derive from the single routine row.** There is no producer table and no
subscription table. The scheduler walks the routine store on start and reload
and builds a timer _and_ a subscription. One record, one editor, one lifecycle;
the Routines screen, the CLI and the protocol see a routine exactly as before.

**Rule: no free-standing schedule producers.** A schedule exists only because a
routine owns it. A bare timer publishing into the void reintroduces orphans and
two places to edit one thing.

**`lastFiredAt` is the subscription cursor.** The field that answers "did we
miss a run while we were down" is what a durable bus calls a per-subscriber
position. Catch-up becomes a cursor comparison, and every future trigger
inherits it instead of reimplementing it.

Building routines on the bus from the start is deliberate: it's the trigger we
understand best, so if the bus can't express it cleanly, the design is wrong and
we find out before anything else depends on it.

### The matcher

**An event type plus optional exact-match on fields.** Equality only — no
operators, no expression language:

```
{ type: "schedule.fired", where: { source: "routine:daily-digest" } }
{ type: "file.created",   where: { visibility: "org" } }
```

It covers every case in this plan, indexes trivially, and can't be written wrong
in a way that silently matches everything. When it isn't enough, the job does
the filtering — with a model that's better at judgement than any predicate
language would be.

### Loop protection

**A causation chain on the envelope, plus a depth cap.** Every event carries the
chain of subscriptions that produced it; a match is refused if that subscription
is already in the chain. That catches a cycle exactly with no threshold to tune;
the depth cap catches runaway fan-out that never repeats. The chain also answers
"why did this job open", which is worth having anyway.

**Shared with agent-to-agent calls** (§8), so a cascade crossing between a
subscription and an agent call is one causal path with one guard.

### Scope

**Tenant-scoped by default**, so a subscription can't fire on a colleague's
activity by accident. A short, named, auditable list is org-wide: a file
promoted to shared, a tool added or removed by an admin.

## 6. Skills

**Flue already implements this.** `flue/packages/runtime/src/types.ts:183` is the
Agent Skills spec — `name` and `description` as the always-present catalog line,
`instructions` loaded only on activation, supporting `files`, and `allowedTools`.
`WorkspaceSkill` (`types.ts:222`) is runtime discovery from a directory, read
from disk on activation.

So "agents write their own skills and have them on lookup" is: give each agent a
directory, a tool that writes `SKILL.md` into it, and let Flue discover them.
Progressive disclosure, the catalog and activation are done.

**Scope.** An agent writes into its own directory and reads its own plus an
**org directory an admin curates** — where the house style lives. Mirrors
memory: private by default, no write conflicts, nothing leaks.

**Trust.** A skill is persistent instruction, the same risk the memory primer
names — a wrong note is a bug that persists until someone removes it. Answered
the same way: **active immediately, visible and editable**, with a Skills screen
and a CLI. Operator approval would make the operator the bottleneck on the
feature meant to save them time.

**Except `allowedTools`, which is admin-only.** The spec calls it "pre-approved
tools"; an agent-written skill that could set it would route straight around §3.

## 7. Search

**SQLite FTS5** over file text and memory bodies, tenant-filtered, ranked by
bm25. Verified working in `node:sqlite` on Node 26 with zero dependencies.

**No embeddings yet.** The Codex login is a chat credential and grants none;
semantic search needs a separate API key or a local ONNX model, and neither is
worth it before keyword search has been used in anger. The search tool's
interface leaves room for a vector backend — expect to want it, because "find
what I wrote about the auth rewrite" is a paraphrase query and keyword search
misses paraphrase.

## 8. Agent-to-agent

[`agent-to-agent.md`](agent-to-agent.md) stands: blocking calls, one thread per
pair, threads read-only and not tabs, no unread, no request record.

**One addition.** It deferred loop protection, saying the shape would be a call
chain. §5 builds exactly that, so a2a adopts and shares it.

**One caveat from §3's finding.** A blocking a2a call is bounded by its own
timeout (60s in that plan), which is well inside Flue's one-hour submission
timeout. That is what makes blocking safe there and unsafe for a human confirm
— worth stating, because the two look alike and aren't.

## 9. Audit and costs

**Cost comes from Flue.** It prices every turn against the model's own cost
table, and `PromptUsage` breaks out input, output, cache-read and cache-write
separately. The prototype already captured this and buried it in a JSON blob.

**Usage gets columns** on the audit row from the first commit: `tokens_in`,
`tokens_out`, `cache_read`, `cache_write`, `cost_total`, `model`, `tenant_id`.
The spend page is then a few `GROUP BY`s with no derived store to drift. This
must be right from day one — cost you didn't record cannot be backfilled.

**The page.** Your own spend by agent, job, routine and model over a date range.
Admins get the same with a tenant dimension. Nobody sees a colleague's job
titles.

**Gap:** only model turns are priced. A Firecrawl call costs real money and will
not appear. Know that before trusting the page as the whole bill.

## 10. Memory

| Tier         | What it is                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- |
| **Raw**      | Append-only observations. Cheap to write, never in a prompt, FTS-searchable.              |
| **Digested** | Named consolidated notes, with provenance back to the raw notes behind them.              |
| **Pinned**   | The small digested subset in the system prompt. Capped; a full shortlist fails the write. |

Writing gets cheap, because the agent no longer decides on the spot whether
something deserves a permanent slot. The digest makes that call later, with more
evidence.

This resolves the memory primer's own objection. It rejected an append-only log
because "ten notes about Atlas, most of them out of date, and no way to tell
which is current" — true of a log with nothing consolidating it. The digest is
the missing half.

**Who digests:** an **optional per-agent routine** — a bus subscription opening
a job, so the digest is inspectable afterwards as ordinary job history — **plus
a tool** the agent can call when it notices its own log is messy. The routine is
the reliable path; the tool is the responsive one.

The cap behaviour stays: a full pinned shortlist fails the write rather than
evicting silently.

---

# Part 2 — Schemas

Zod in the protocol package, as the single source of truth. Sketches, not final
— but the fields are the decisions.

## The event envelope

```ts
export const EventEnvelope = z.object({
  id: z.string(),
  type: z.string(), // "schedule.fired", "file.created", …
  tenantId: z.string(),
  scope: z.enum(["tenant", "org"]), // org is a short, named list
  source: z.string(), // "routine:daily-digest", "job:42"
  payload: z.record(z.string(), z.unknown()),
  /** Subscriptions that produced this event, in order. Cycle guard + provenance. */
  chain: z.array(z.string()),
  depth: z.number().int().nonnegative(),
  at: z.string(), // ISO
})
```

`chain` is shared with agent-to-agent calls. A match is refused when the
subscription id is already in `chain`, or when `depth` exceeds the cap.

## A subscription

```ts
export const Subscription = z.object({
  id: z.string(),
  tenantId: z.string(),
  match: z.object({
    type: z.string(),
    where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
  agent: StaffId,
  instruction: z.string().min(1),
  /** Per-subscriber position. For a routine this is its lastFiredAt. */
  cursor: z.string().nullable(),
  enabled: z.boolean(),
})
```

Derived for routines, stored for everything else.

## A file

```ts
export const StaffFile = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string().min(1),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  source: z.enum(["operator", "agent", "job"]),
  visibility: z.enum(["private", "org"]),
  agent: StaffId.nullable(), // who produced it
  jobId: z.number().int().nullable(),
  messageId: z.string().nullable(), // the message it was attached to
  createdAt: z.string(),
})
```

Bytes live at `$STAFF_HOME/files/<id>`, never in the row.

## A memory note

```ts
export const MemoryNote = z.object({
  tenantId: z.string(),
  agent: StaffId,
  tier: z.enum(["raw", "digested"]),
  /** Digested notes are named and replace by name; raw notes are append-only. */
  key: z.string().nullable(),
  body: z.string().max(2_000),
  pinned: z.boolean(), // digested only
  /** For a digested note: the raw notes it consolidated. */
  derivedFrom: z.array(z.string()),
  source: z.string(), // conversation or job that produced it
  createdAt: z.string(),
  updatedAt: z.string(),
})
```

Primary key `(tenantId, agent, key)` for digested; raw notes are rows with a
null key.

## An approval

```ts
export const Approval = z.object({
  id: z.string(),
  tenantId: z.string(),
  jobId: z.number().int().nullable(), // null for a chat-originated gate
  session: z.string(),
  tool: z.string(),
  argumentsHash: z.string(), // binds the token to this exact call
  state: z.enum(["pending", "approved", "denied", "cancelled"]),
  reason: z.string().nullable(),
  createdAt: z.string(),
  answeredAt: z.string().nullable(),
})
```

One-shot: consumed on the call that matches `(jobId, tool, argumentsHash)`.
Cancelled when the job's deadline expires.

## Audit usage columns

Not a schema so much as a shape to get right at the first migration:

```
tokens_in, tokens_out, cache_read, cache_write, cost_total, model, tenant_id
```

---

# Part 3 — Build order

Greenfield, so the order of construction is the plan.

## 0. Walking skeleton

Two users, one agent each, streaming chat that survives a restart.

better-auth, tenant-namespaced session keys, one generic agent, Flue
persistence, and the isolation contract test — end to end, as thin as possible.

This proves the riskiest thing in v2: that the tenant seam holds through the
whole request path, **including inside a Flue submission resumed from the poll
loop**. Nothing else is worth building if that's wrong. It also forces the
better-auth-on-`node:sqlite` question to an answer immediately.

Done when: two accounts, each chatting with their own agent, neither able to see
the other's conversation, and both intact after a restart.

## 1. The spine

Rebuild what the prototype proved, in dependency order, with the v2 shape baked
in from the first commit.

1. **Audit** — the `observe()` tap, with cost as columns from the start. Cost
   not recorded now cannot be recovered later.
2. **Jobs** — the state machine, job sessions, the toolset, deadlines.
3. **The bus and routines** — envelope, subscriptions, the matcher, the
   causation chain and depth cap; routines built as subscriptions, not ported to
   them.
4. **Files** — one concept, bytes on disk, `source` and `visibility`.

At the end of this you have the prototype's capability on v2's foundations.

## 2. Tools and safety

5. **The tool catalog** — org-configured entries, shared-vs-per-user
   credentials, encryption at rest.
6. **Attention and confirm-gates** — the render-time wrapper, suspend-and-resume,
   one-shot approvals, cancellation on deadline expiry.

Gates come with the tool layer rather than after it, because retrofitting a
wrapper around tools that already assume they can act is the kind of change
that misses one.

## 3. What agents know

7. **Search** — FTS5 over files and memory.
8. **Memory** — three tiers, the digest routine and the digest tool.
9. **Skills** — per-agent and org directories, the write tool, Flue's discovery.

## 4. Talking and looking

10. **Chats and agent-to-agent threads** — per `agent-to-agent.md`, sharing the
    chain from step 3.
11. **The UI** — throughout, but the admin surfaces land here: the spend page,
    accounts and roles, the shared file space, the org tool catalog.

## Sequencing notes

- Steps 5 and 6 could run in parallel with 7–9; nothing in "what agents know"
  depends on the tool catalog.
- Step 10's threads depend on the bus's chain, so they follow step 3.
- The UI trails each step rather than waiting for the end — `ui.md`'s
  one-file-per-change rule makes that cheap.

---

# Open questions

1. **better-auth on `node:sqlite`.** Adapter unconfirmed; may pull in a
   dependency. Resolve in step 0.
2. **Non-model costs are invisible** on the spend page. Firecrawl and other
   metered APIs go unpriced.
3. **One crash domain and team-wide restarts** — the accepted price of a shared
   `flue.db`. Reversible additively: a supervisor and a proxy, no store rewrite.
4. **Depth cap value** for the bus. A guess until something loops.
5. **How raw memories get written.** A separate tool, or a tier argument on the
   existing write — decide when step 8 is picked up.

# Related

- [`../primers/architecture.md`](../primers/architecture.md),
  [`../primers/jobs.md`](../primers/jobs.md),
  [`../primers/memory.md`](../primers/memory.md),
  [`../primers/tools.md`](../primers/tools.md),
  [`../primers/ui.md`](../primers/ui.md),
  [`../primers/operations.md`](../primers/operations.md) — read before rewriting
  the area each describes.
- [`event-bus.md`](event-bus.md) — the idea this plan settles.
- [`prd-files.md`](prd-files.md), [`agent-artifacts.md`](agent-artifacts.md) —
  the two halves §4 collapses into one.
- [`agent-to-agent.md`](agent-to-agent.md) — stands, plus the shared chain.
- [`job-deadlines.md`](job-deadlines.md) — bounds a suspended confirm-gate.
