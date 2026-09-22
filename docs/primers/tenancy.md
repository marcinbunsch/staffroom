# Tenancy — a primer

Many people share one Staffroom process. Keeping their work apart is the single
most load-bearing decision in the system, and it rests on one idea: **the tenant
rides in the session key, and nowhere else.** Everything here follows from that.

## The one-paragraph version

A tenant is a better-auth user id. Every row in `staffroom.db` carries a
`tenant_id` that _is_ that user id; every agent session key begins with it. The
key — `tenant:agent`, `tenant:agent__job-7`, `tenant:agent__a2-devops` — is the
only durable carrier of "whose turn is this", because the alternatives (a
request, headers, an async context) are all gone by the time a job resumes from
the poll loop. Isolation is then two disciplines that hold that line: a route
guard that refuses to let one user address another's session, and a store
convention that makes a missing `WHERE tenant_id = ?` visible in review.

## A tenant is a user

There is no separate "organisation" table and no tenant id of our own making. A
tenant _is_ a better-auth user id (`TenantId` in `protocol:identity.ts`). One
org holds one team behind one login; the "tenant" and the "account" are the same
thing. This is why better-auth's own tables live in `staffroom.db` alongside the
rows that point at them (see `architecture.md`) — the thing every `tenant_id`
references should not sit in a different file.

Because we do not generate these ids, the schema describes what we can _rely_
on rather than what we would have picked: a tenant id is any non-empty string
with no `:` in it. The `:` is excluded only because it is the session-key
separator. That is the whole constraint — `TenantId` is `min(1)` plus
`/^[^:]+$/`, and the comment says so out loud.

## The tenant rides in the session key

Flue claims submissions from a poll loop. A job opened this morning and resumed
after a server restart this afternoon renders with **no request, no headers, and
no async context** — the turn is picked up by a worker, not served to a caller.
An `AsyncLocalStorage` tenant would be empty in exactly the place it matters
most. So the tenant travels where Flue already carries something durable across a
restart: the session key itself, which Flue persists on the submission and hands
back on resume.

The grammar, parsed by `parseSessionKey` in `protocol:identity.ts`:

| Session key                | Means                                                     |
| -------------------------- | --------------------------------------------------------- |
| `tenant:agent`             | a member's main chat                                      |
| `tenant:agent__job-<n>`    | that member working one job                               |
| `tenant:agent__a2-<other>` | that member answering another agent (`agent-to-agent.md`) |

Parse order is **tenant on the first `:`, then agent, then the suffix.** Taking
the tenant off the front first is what lets `_` and `__` appear freely in a
tenant id without ambiguity — nothing looks for the job separator until the
tenant is already gone. It also makes `:` the one character a tenant may not
contain, which is precisely the one line `TenantId` encodes. `AgentId`, by
contrast, is ours to choose, so it is kept narrow (lowercase, digits, hyphens,
no underscore) — that is what keeps `__` unambiguous as the suffix marker no
matter what an agent is named.

`parseSessionKey` returns `undefined` for anything malformed rather than
throwing: its callers are request handlers that owe a 400 or a 404, and every
one has a better answer than a stack trace. `composeSessionKey` is the inverse
and _does_ throw, because composing always happens from values the server
already holds — bad input there is a bug, not a request. `sessionTenantId` is a
one-liner over `parseSessionKey`, split out so the guard reads as a single line
and there is exactly one place that decides what "the tenant of a session"
means.

## The enforcement point: two questions, not one

This is the crux. Flue's `createAgentRouter` takes the instance id **straight
from the URL path**, so `/agents/<someone-else>:devops` is a string the _client_
composes. A bearer token or cookie answers "who is asking" — it does not answer
"whose session did they name." And because the session key is also where every
downstream lookup gets its tenant, an authenticated user who simply types
another tenant's key would find the whole system agreeing with them.

Two middlewares on `/agents/:id` close this, in order (`server:middleware/session.ts`):

- `requireSession` resolves the better-auth session and stashes the `Caller`
  (tenant id + role), or answers 401. This sits at the pipeline root because
  **Flue drops caller headers after admission** — this is the one place auth can
  still see them.
- `rejectForeignSession` parses the tenant out of the path with
  `sessionTenantId` and compares it to the caller's. A mismatch is 403. An
  **unparseable** key is refused with 400, not passed through: a key with no
  owner must never read as "mine." This must run _before_ Flue admits the
  conversation, for the same header-dropping reason.
- `rejectUnknownAgent` then 404s an agent the caller's roster does not contain.
  It runs last, so a missing agent here is honestly "not found" and not a
  disguised authorization failure — the key is already known to parse and to be
  theirs.

## Resolving a turn is a pure function

`resolveAgentSession` (`server:agents/resolve-session.ts`) turns a session key
plus the stores into everything a turn needs — the identity, the staff member,
the model, the credential that pays — **and takes no ambient input at all.**
That signature _is_ the tenancy claim: "a turn is recoverable from the key
alone" is a property you can only really check if the function that does it can
depend on nothing else. A resumed turn and a live turn call the same function
with the same argument, so they cannot diverge. It returns a tagged result
(`ready` | `invalid-session` | `unknown-member` | `no-credential`) rather than
throwing, because a resumed job needs an answer to render, not an exception.

`resolve-session.test.ts` feeds it the exact strings a resumed job arrives with.
Two tenants each own an agent literally named `devops`; `alice:devops__job-7`
and `bob:devops__job-7` must land on different rows, different system prompts,
different credentials, and therefore different providers — one tenant's turn
cannot be billed to another's key. The test does not spawn servers or call
models: Flue's durability (persisting the key, handing it back) is Flue's
guarantee to verify, not ours.

## Every store takes `tenantId` as an explicit first parameter

Not a scoped handle, not an ambient value — a plain first argument on every
method: `roster.get(tenantId, agentId)`, `credentials.create(tenantId, …)`. The
point is legibility of the failure. One `staffroom.db` holds every tenant's
rows, so a read that forgets its `WHERE tenant_id = ?` does not crash and does
not log; it silently returns a colleague's data, and the wrong query looks
exactly like the right one minus five words. With the tenant as an explicit
parameter, the argument that _should_ feed the `WHERE` clause sits on the same
line as the call — a missing filter is visible where the value is passed.

Cross-tenant reads do exist (an operator listing across the whole install), and
they are given loudly-named methods like `listAcrossTenants()` so that the
absence of a tenant argument is a deliberate, greppable choice rather than an
oversight.

### The isolation contract ships with every store

`defineTenantIsolationTests` (`server:tests/tenant-isolation.ts`) is the shared
contract, mirroring Flue's own store-contract tests. It writes as tenant A and
tenant B and asserts A never sees B on read, list, update, or delete (update and
delete are optional, skipped when a store lacks them). Every store's test file
calls it. That is the entire enforcement mechanism: a store whose test file does
_not_ call it is visible in review. It earns its keep — deliberately dropping one
`WHERE` clause turned four of these tests red, which is exactly the class of bug
inspection cannot be trusted to catch. This is why it exists before the first
store rather than after the tenth.

## Shared-versus-private

Not everything is strictly private. Files, credentials, and skills follow one
recurring idiom: **"mine, plus what the org shares"** — a query of the shape
`tenant_id = ? OR visibility = 'org'` (or `scope = 'org'`). The tenant filter is
still there; it is widened by an explicit disjunction, never removed. The
domain primers (`files.md`, `tools-and-credentials.md`, `skills.md`) each cover
their own version.

## One process, one `flue.db`

Flue keeps module-scoped registries and expects one runtime per process, and its
submission-claim queries are not tenant-filtered — the poll loop claims _work_,
not one tenant's work. So the design is a single shared `flue.db` with per-tenant
namespacing living entirely in the session key, rather than a Flue instance per
tenant. Model providers register per-credential into that one global runtime
(`architecture.md`), which is what lets a per-tenant API key work inside a shared
process.

This is reversible **additively**: because tenancy is carried in data (the key
prefix, the `tenant_id` column) and never in process identity, a future
process-per-tenant or shard-per-tenant split is a routing change in front of the
same schema, not a rewrite.

## The accepted costs

This is a shared-fate design, and honesty about that is the point:

- **One crash domain.** An unhandled fault takes down every tenant, not one.
- **A team-wide pause on draining.** Stopping the process to drain or migrate
  stops everyone's jobs at once; there is no per-tenant maintenance window.
- **One blast radius.** A tenancy bug — a dropped `WHERE`, a guard that let a
  foreign key through — is a cross-tenant data leak, not a local glitch. That is
  the whole reason the guard, the explicit `tenantId` parameter, and the
  isolation contract are non-negotiable rather than nice-to-have.

## Where to go next

`jobs.md`, for what a job session actually is and why it is the thing that most
needs the key to survive a restart.
