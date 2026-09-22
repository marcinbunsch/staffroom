# Staffroom — plan of attack

How [`staffroom-plan.md`](staffroom-plan.md) gets built. The plan decided _what_
and _why_; this decides _in what order_, _what gets lifted from the prototype
verbatim_, and _what has to be true before each step is called done_.

Written 2026-09-02, after reading the prototype and the Flue 2.0.3 checkout.

> **On `prototype/…` paths.** Staffroom v2 grew out of a single-user prototype
> that is not part of this repository and is not public. Paths beginning
> `prototype/` are references to that local checkout; they do not resolve here.
> Kept as written rather than scrubbed, because they record which decisions were
> inherited and which were made fresh.

> **Build status is at the end — see [Part 5](#part-5--build-status-2026-09-04).**
> Parts 0–4 are the original plan and its mid-build decisions, kept as the
> record of _why_. The build has since taken detours the milestone text does not
> mention (an Integrations layer, tool compaction, a memory redesign, a
> simplified MCP gateway). Part 5 reconciles the plan with what actually got
> built and states what remains. When the two disagree, Part 5 wins.

---

## Part 0 — What was verified

Four of the plan's claims were checked against the source before planning
around them. Three hold; one needs a decision the plan didn't anticipate.

**One runtime per process — holds.** `flue/packages/runtime/src/node/start.ts:7`
says exactly what the plan quotes.

**Unfiltered claim queries — holds, and it's worse than a session filter would
fix.** `sql-agent-execution-store.ts:166` selects every `queued` submission with
`canonical_ready_at IS NOT NULL` across the whole table; the only correlated
subquery is a per-`session_key` ordering guard, not a scope filter. Two
processes on one `flue.db` will claim each other's work. The plan's conclusion —
shared store, one process, tenant-namespaced session keys — is the right one.

**Flue implements the skills spec — holds, but its _discovery_ is unusable for
us.** `types.ts:183` is the spec. But `WorkspaceSkill` discovery
(`context.ts:40`, `discoverLocalSkills`) reads `.agents/skills/<name>/SKILL.md`
through the **session's sandbox**, under a basePath scoped to that sandbox's
cwd — so it only works for agents that have a sandbox attached, and the
prototype grants those to a minority. The plan's §6 sketch ("give each agent a
directory and let Flue discover them") does not survive that. **Skills are rows
in `staff.db`, mounted with `useSkill()` at render time** — see M10, where that
decision is now settled rather than open.

**`node:sqlite` supports FTS5 — holds.** Verified locally on Node 26.1: a
virtual table, a `MATCH` query and a `bm25()` rank, zero dependencies.

### Open question 1 is answered: better-auth runs on `node:sqlite`

better-auth 1.7.2 accepts a `DatabaseSync` instance directly as its `database`
option (supported since Node 22.5; documented alongside `better-sqlite3` and
`bun:sqlite`, all three routed through its Kysely adapter, which ships in the
main package as `@better-auth/kysely-adapter`). No native dependency, no
adapter to write.

```ts
import { DatabaseSync } from "node:sqlite"
betterAuth({ database: new DatabaseSync(join(STAFF_HOME, "staff.db")) })
```

Two things to settle in M1 rather than assume:

- **Same file or its own?** Recommend the same `staff.db` — `tenant_id` is a
  user id, so keeping the user table in the same file makes the isolation tests
  and backups one thing rather than two. better-auth owns its own tables and
  migrates them itself.
- **Same connection or a second one?** Recommend a **second `DatabaseSync` to
  the same file**, with `journal_mode=WAL` and `busy_timeout` set on both. Handing
  better-auth the connection the stores share would put its Kysely migrations on
  the same handle as every synchronous store call. WAL plus a busy timeout is
  what the prototype already does (`coordinator/db.ts`) and it is enough.

### Open question 4 gets a default: depth cap = 5

The prototype already caps the job tree at `MAX_DEPTH = 5`
(`coordinator/jobs.ts:25`). The bus's depth cap should be the same number and
the same constant, because a cascade that crosses between a subscription, an
agent-to-agent call and a child job is one causal path — the plan says as much
in §5 and §8. A single shared cap is one thing to tune, not three.

---

## Part 1 — Decisions to make before the first commit

These shape every file written afterwards. None is expensive now; all are
expensive at M5.

### 1. How the tenant is passed to a store

**Recommendation: an explicit `tenantId` first parameter on every store method.**
Not a constructor-scoped handle, and not ambient context.

```ts
list(tenantId: string): Job[]
get(tenantId: string, id: number): Job | undefined
```

A scoped handle (`jobs.for(tenantId).list()`) reads better but hides the seam
exactly where it needs to be visible, and it needs an escape hatch for the admin
spend view anyway. With an explicit parameter, a query missing its
`WHERE tenant_id = ?` is visible in the same line as the parameter that should
have fed it. Cross-tenant admin reads get their own loudly-named methods —
`listAcrossTenants()` — so they are greppable and reviewable as a closed set.

### 2. Where the tenant is bound into the session key — and where it is enforced

Session keys are `${tenantId}:${agentId}` and `${tenantId}:${agentId}__job-42`,
parsed by an `identity.ts` lifted from the prototype and extended with a tenant
segment. Parse order: tenant on the first `:`, agent up to `__`, job from
`__job-`.

**The enforcement point is the thing to get right.** Flue's
`createAgentRouter(StaffAgent)` uses the URL path parameter as the instance id,
so `/agents/<someone-else>:devops` is a request the client composes. The bearer
gate authenticates _who is asking_; it does not check _whose session they named_.

So: a middleware on `/agents/:id` that resolves the better-auth session, parses
the tenant out of the path parameter, and **403s on any mismatch** — before Flue
admits the conversation. This is one function and one test, and it is the single
line the whole multi-tenancy decision rests on. The prototype already has the
right shape at `app.ts:90` (`rejectUnknownStaff`); this replaces it with
`rejectForeignSession`, which also does the unknown-agent check.

The UI needs its own tenant id to compose those URLs — one `/api/me`.

### 3. The isolation contract test exists before the first store

`defineTenantIsolationTests(makeStore)`, mirroring Flue's own
`test-utils/define-store-contract-tests`. Write it in M1 against the roster
store, so every store after it imports a helper that already exists. A store
whose test file doesn't call it is visible in review — that is the whole
enforcement mechanism, so it can't arrive late.

### 3b. Model credentials are data, not a file on the server

_Decided during M1, superseding the prototype's `registerCodexSubscription()`._

The prototype read `~/.codex/auth.json` off the server's own filesystem and
registered one process-global provider from it. That is single-user by
construction: one machine, one login, everyone's turns billed to whoever last
ran `codex login` there.

**Credentials become rows,** in two scopes — exactly the rule the plan already
sets for tool credentials in §1, so this is one idiom rather than two:

- **Organization** — an admin's shared API key. Admin-only to create or delete.
- **Personal** — one person's own key, or an **imported ChatGPT/Codex login**.
  The desktop app reads `auth.json` locally; the browser uploads it. Either way
  the server stores and refreshes it from then on, which is the point: an agent
  running unattended at 3am cannot depend on a file in somebody's laptop.

**One credential registers as one Flue provider.** This is forced, not chosen.
Flue keeps one runtime per process and its provider registry is module-scoped
and keyed by id, so there is no "current tenant's provider" at the moment a
model call happens — a job claimed from the poll loop has no ambient anything.
Putting the credential _in the provider id_
(`anthropic-org`, `anthropic-7f3a91c2b4d0`) moves the choice to render time,
where the tenant is already known.

A staff row therefore stores a **bare model id** (`gpt-5.5`) plus an optional
`credential_id`; a row naming no credential uses the organization's default,
which is what lets an agent work before anyone has connected a personal key.

Three things learned against the running server, all worth keeping:

- **Aliasing a provider means re-stamping its catalog.** A pi-ai `Model` carries
  its own `provider` field, and while Flue _finds_ the model through the
  registry key, auth resolves from `model.provider`. Alias only the provider and
  every turn authenticates against the built-in id — failing with "Provider is
  not configured: openai-codex" while the alias sits in the registry looking
  perfectly correct.
- **There is no reachable `deleteProvider`.** pi-ai's registry has one; Flue
  exports `setProvider` and nothing else. A retired credential is replaced by a
  provider that resolves no credential, which pi-ai treats as unconfigured. The
  dead id lingers until restart, which is harmless — nothing can select it.
- **Encryption at rest arrives now, not at M6.** These are the first stored
  secrets, and a secret written in the clear today stays in the clear in every
  existing database. AES-256-GCM per record, versioned, key resolved exactly
  like the auth secret.

### 4. Naming and toolchain

`@staffroom/{protocol,server,cli,ui}`. Otherwise the prototype's toolchain
verbatim: pnpm workspace, TypeScript 7, native ESM with `.ts` import specifiers,
`verbatimModuleSyntax`, oxlint + oxfmt at defaults, vitest, Node ≥26. Zod in
`protocol`, **valibot for Flue tool inputs** (Flue's convention, kept separate —
worth restating because mixing them is the easy mistake).

### 5. Nothing is copied into `docs/`

This is a fresh start, and prototype-era documentation would be false on
arrival: the primers describe a single-user system with three databases and a
file map that no longer holds. They stay where they are, read as reference
before rewriting the area each describes — which is what the plan already says
they are for. Every v2 primer gets written by the milestone that builds the
thing it documents.

There is one real gap this leaves. `staffroom-plan.md` **normatively defers** to
two documents that are not in this repo: §8 says "`agent-to-agent.md` stands",
and §3 bounds a suspended confirm-gate by `job-deadlines.md`. A reader of this
repo cannot open either, so the plan is, strictly, incomplete.

The fix is not a docs migration. It is:

- **Repoint the links** at `prototype/docs/plans/…`, so a deferral is an
  explicit reference to the reference material rather than a broken link. One
  edit per link, in `staffroom-plan.md`.
- **Absorb the decisions at the milestone that needs them** — deadlines into
  M3, agent-to-agent into M11 — as v2 prose written against what actually got
  built. The prototype's prose is worth stealing sentence by sentence; the
  documents are not worth inheriting whole.

Until then the prototype is a local, gitignored reference, exactly as the plan
intends.

---

## Part 2 — Milestones

Each names what to lift, what to write fresh, and what must be true to move on.
"Lift" means copy the file and adjust imports; "lift the shape" means rewrite it
with the tenant seam in, keeping the structure and the comments.

### M0 — Repo skeleton

Workspace, four packages, `pnpm check` green on an empty tree. Lift verbatim:
`tsconfig.base.json`, `.oxfmtrc.json`, `.editorconfig`, the root `package.json`
scripts, the Makefile's deploy shape. No documentation is copied (decision 5) —
the only doc change here is repointing the plan's two deferred links at the
prototype.

**Done when** `pnpm check` passes. _CI deferred — no pipeline yet, by choice._

### M1 — Walking skeleton _(plan step 0 — the one that can invalidate everything)_

better-auth; two accounts; one generic `StaffAgent`; roster store with
`tenant_id`; tenant-namespaced session keys; the `rejectForeignSession` guard;
Flue persistence pointed at `flue.db`; `defineTenantIsolationTests`.

_No minimal UI._ The design already exists in the prototype, so a placeholder
would be thrown away without resolving anything the HTTP tests do not already
cover. The UI lands as one real pass when a screen is actually needed — first
plausibly the credential import, once someone other than us has to connect a
Codex login. The one thing a minimal UI would have de-risked is unrelated to
UI: whether `@flue/react` streams through `rejectForeignSession` with a `:` in
the path and a cookie attached. That is a transport test, still owed.

Lift: `identity.ts` (extended), `db.ts`, `coordinator/db.ts`,
`providers/openai-codex.ts`, `agents/staff-agent.ts`'s structure minus every
toolset. Write fresh: auth, the roster store, the guard.

**Done when** two accounts each chat with their own agent; neither can read the
other's conversation _via the API or by hand-composing a session key_; both
survive a restart; and — the test that actually proves the plan — **a job-shaped
session resumed from Flue's poll loop after a restart still resolves the right
tenant**, since that is the case an `AsyncLocalStorage` tenant would have lost.

**How that is checked.** Not by restarting a server: doing it end to end meant
spawning the built server twice and calling a real model, which is 35 seconds
and a bill for re-verifying somebody else's durability engine. Tests do not call
real models and do not take 35 seconds.

The claim splits in three. That the session key is persisted on the submission,
and handed back on resume, are **Flue's** guarantees. That the key alone is
enough to land on the right tenant is **ours** — and that is the part worth
testing. So resolution lives in `resolveAgentSession(sessionKey, stores)`, a
pure function whose signature is most of the argument: it has no ambient input
available, so a resumed turn and a live one cannot diverge. The tests feed it
the exact keys a resumed job arrives with, including two tenants owning the same
agent id and the same job number.

### M2 — Audit, with cost as columns

The `observe()` tap. Lift `flue-audit.ts` almost whole — its event mapping,
`instanceId` attribution, the `tool_start`/`tool` argument pairing, and the
crash-to-job-failure rule are all hard-won and none of them are tenant-shaped.
Write fresh: the audit store, with `tenant_id, tokens_in, tokens_out,
cache_read, cache_write, cost_total, model` as **columns**, not a payload blob.

**Done when** a turn in tenant A's session produces a priced row attributed to
A, and the spend query is a `GROUP BY` over columns.

Carry forward the known gap: only model turns are priced. A Firecrawl call costs
money and will not appear.

### M3 — Jobs, with deadlines included

The state machine, job sessions, the toolset, the tree caps, the digest, the
close-notifies-originator rule. Lift the shape of `coordinator/jobs.ts` and
`tools/job-tools.ts` closely — the semantics are proven — adding `tenant_id`
throughout.

**Include `deadline_at` / `on_overrun` / `escalated_at` now**, not later. The
plan's confirm-gate design (§3, step 5) requires a job deadline to cancel a
pending approval, so deadlines are a dependency of M7 rather than a later
nicety, and three nullable columns are free at first migration. Read
`prototype/docs/plans/job-deadlines.md` before writing them; this milestone
lands the v2 jobs primer, and the deadline decisions live in it — that is how
the plan's §3 deferral gets closed.

**Done when** the jobs contract tests pass, isolation tests included, and an
overrun sweep escalates exactly once.

### M4 — The bus, and routines as subscriptions

The envelope, the subscription store, the equality matcher, the causation chain
and the shared depth cap of 5. Routines are **derived** from the routine row on
start and reload — a timer and a subscription, one record, no producer table.
`lastFiredAt` is the cursor; catch-up is a cursor comparison.

Lift the shape of `scheduler.ts` (croner, the catch-up rule, the guard that
stops one bad routine killing the loop) and `routines-store.ts`.

**Done when** a routine fires through the bus into a job; a subscription that
would re-enter its own chain is refused; and a routine that missed a run while
the process was down catches up or skips per its flag.

This is the milestone that tests the plan's own bet: if routines don't express
cleanly as subscriptions, the bus design is wrong and this is where we find out.

### M5 — Files

One concept: metadata in `staff.db`, bytes at `files/<id>`, `source`,
`visibility`, promotion by a human only. Publishes `file.created` — which closes
the loop with M4 and gives the bus a second event type before anything depends
on it having only one.

Lift: `coordinator/files.ts` and `tools/file-tools.ts` shapes; fold in what
`artifacts.ts` did that files didn't (job/agent provenance links).

### M6 — Tool catalog and credentials

Org-configured entries, shared-vs-per-user credentials, AES-GCM at rest keyed
from `STAFF_SECRET_KEY`, and the rule that a per-user tool is not offered to an
agent whose owner hasn't connected.

Lift **verbatim** (no tenant dimension in any of them): `firecrawl.ts`,
`gmail.ts`, `calendar.ts`, `google-auth.ts`, `current-time.ts`,
`host-metrics.ts`, `docker-sandbox.ts`, `mcp-gateway.ts`, `mcp-oauth.ts`.
Write fresh: `registry.ts`, the catalog store, the token store.

Encryption at rest already exists — model credentials brought it forward into
M1 (decision 3b), so this milestone reuses `coordinator/secrets.ts` rather than
introducing it.

#### The tool credential taxonomy (decided during M6, from the real integrations)

The plan's §1 "per tool: org secret or per-user" is two of five real shapes. A
tool declares a **provisioning shape**; the registry resolves it and applies one
offer-or-not rule across all of them (skip a tool whose owner lacks what it
needs):

| Shape                | Org part         | Per-user part              | Examples                                              |
| -------------------- | ---------------- | -------------------------- | ----------------------------------------------------- |
| `none`               | —                | — (or a runtime probe)     | clock, http_request; Docker (probe: is the daemon up) |
| `org-key`            | shared key       | —                          | Firecrawl                                             |
| `user-key`           | —                | own token                  | (no built-in yet; a raw personal key)                 |
| `oauth`              | admin app config | per-user OAuth token       | Gmail, Calendar, **Slack**                            |
| `org-key-user-grant` | shared secret    | per-user allow (no secret) | GCP (one service account, per-user access)            |

Two things the flat enum missed: **two-part credentials** (org app config _plus_
a per-user token, for OAuth) and **grant-without-secret** (a shared key gated by
a per-user allow, for GCP).

**MCP servers are a separate family, not catalog tools.** Sentry and Notion are
reached through the MCP gateway and authenticate with per-user OAuth whose
endpoints the server advertises — an automatic-grant flow (sent to the server,
consent, return with a token). The gateway and its per-user token store are a
deferred verbatim lift; the token storage is the same shape as `oauth`, only
with discovered endpoints.

Built now: the credential store (org / user / grant), the registry resolution
across all five shapes, and two no-credential tools. The credential-backed tool
_implementations_ (Firecrawl, Gmail/Calendar/Slack OAuth, GCP, Docker) and the
MCP gateway are the deferred lifts.

### M7 — Attention and confirm-gates

The render-time wrapper around a gated catalog entry's `run`; suspend-and-return
rather than block; one-shot approvals bound to `(job, tool, argumentsHash)`; a
new turn dispatched into the same session on an answer; cancellation when the
job's deadline expires.

Lift the shape of `attention-store.ts` and `attention-tools.ts` — the durable
request already exists and is close.

**Done when** a gated call in a job ends the turn cleanly with no lease held
(assert the submission settled), an approval resumes the job as a new turn that
succeeds, a second identical call without a fresh approval is gated again, and a
deadline expiry cancels the pending request so a late approval cannot wake a
dead job.

Gates ship with M6's tool layer, not after it — retrofitting a wrapper around
tools that already assume they can act is the change that misses one.

### M8 — Search

FTS5 over file text and memory bodies, tenant-filtered, ranked by bm25. Leave
the tool interface room for a vector backend; build no embeddings.

### M9 — Memory

Three tiers — raw append-only, digested and named, pinned and capped. The digest
as an optional per-agent routine (a subscription, so it is inspectable as job
history) plus a tool. The cap fails the write; it never evicts silently.

Open question 5 (a separate raw-write tool vs. a tier argument) resolves here.
Recommendation: **a tier argument on the existing write**, defaulting to raw.
The point of the tier split is to make writing cheap, and a second tool name is
a decision the model has to make on every note.

### M10 — Skills

**Skills are rows, not directories.** A skill lives in `staff.db`, scoped to an
owner and an agent, and is mounted at render time with `useSkill()` as an inline
`SkillDefinition`. No filesystem, no sandbox, no Flue workspace discovery.

This follows from the discovery finding in Part 0, and it buys the rest of what
we want for free: the operator can edit a skill, an agent's skills are covered
by the same tenant seam and the same isolation tests as everything else, and
there is no second place where durable agent state lives.

Progressive disclosure survives intact — `useSkill()` puts only the name and
description in the system prompt, and the instructions arrive as the
`activate_skill` tool result — so the per-render cost is one indexed read, not
tokens. That read sits next to the roster read the agent already does on every
turn (`staff-agent.ts`), and `node:sqlite` is synchronous, so it changes nothing
about the shape of a render.

#### The table

```
id, tenant_id, agent, scope, name, description, instructions,
allowed_tools, enabled, source, created_at, updated_at
```

- `scope` is `agent` or `org`. An agent-scoped row carries `tenant_id` and
  `agent`; an org row — the admin-curated house style — carries neither.
- Reads are `(tenant_id = me AND agent = ?) OR scope = 'org'`, which is the
  same shape as the files rule in M5. One idiom for "mine, plus what the
  organization shares".
- `source` is `agent`, `operator` or `admin` — who wrote it, which is what
  `allowed_tools` keys off.
- Unique on `(tenant_id, agent, name)`, and on `(name)` within the org scope.

#### Three rules the store enforces, and why each one is load-bearing

**1. Validate on write, exactly as Flue validates on mount.** Flue's
`normalizeSkillDefinition` requires a name of at most 64 characters matching
`^[a-z0-9]+(?:-[a-z0-9]+)*$`, a description of at most 1024, and non-empty
instructions. A row that violates any of those does not fail at the write — it
throws inside `useSkill()`, which means **every turn for that agent fails**,
including turns that have nothing to do with the skill. So the Zod schema in
`protocol` mirrors Flue's rules exactly and the store rejects the write.

Belt and braces at the mount site: skip an invalid row with a warning rather
than letting it throw. Flue takes precisely this posture for discovered skills
(`context.ts:50` — "must not be able to brick the session"), and a row an agent
wrote is the same category of input.

**2. Resolve name collisions before mounting.** `useSkill()` throws on a
duplicate name within one render (`use-skill.ts:41`), and Flue's own catalog
merge throws on an agent/workspace collision (`context.ts:107`). An agent skill
and an org skill sharing a name is legitimate — it is how an agent specializes
the house style — so we must resolve it ourselves: **agent shadows org**, dedupe
by name, and never hand `useSkill()` two rows with the same name.

**3. `allowed_tools` only from an admin.** Enforced in three places, because §3
routes around it entirely if it leaks: the agent-facing write tool has no such
field in its valibot input; the operator API rejects it without the admin role;
and the mount passes `allowedTools` through only when `source === 'admin'`.

#### Editable by the operator

A skill is persistent instruction, so the plan's answer to the trust question —
active immediately, visible and editable — is what makes it safe. That means:

- **A Skills screen and a CLI**, covering both the per-agent lists and the org
  directory: create, edit, enable/disable, delete. An operator-written skill is
  an ordinary row; nothing distinguishes it from an agent's except `source` and
  the `allowed_tools` restriction.
- **`enabled` as a first-class flag**, so switching a bad skill off is one click
  and does not lose the text. This is the cheap fix for the failure the memory
  primer names — a wrong note that persists until someone removes it.
- **Every write is an audit row** (`skill.created`, `skill.updated`,
  `skill.deleted`) with its author. Persistent instruction changing under an
  agent is exactly the kind of thing the record exists for.

#### Scoped out of v1

`SkillDefinition.files` exists and works, but supporting files stay out. When a
skill needs an attachment, its home is the files store from M5, referenced from
the instructions — one file concept, not two. Likewise SKILL.md import/export:
`parseSkillMarkdown` is not a public export, the columns are the source of
truth, and nothing needs the round trip yet.

**Cap the number of enabled skills per agent**, and fail the write when it is
full. Every mounted skill costs a catalog line in every prompt on every turn, so
this is the same economics as the pinned-memory cap in M9 — and the same
answer, for consistency: fail loudly rather than evict or silently bloat.

**Done when** an agent writes itself a skill and activates it on the next turn;
an operator edits that skill and the change takes effect on the turn after; a
disabled skill leaves the prompt entirely; an agent-authored `allowed_tools` is
refused at the tool, the API and the mount; an agent skill shadows an org skill
of the same name without throwing; and a deliberately malformed row is skipped
with a warning instead of failing the render.

**Dependencies:** M1 and M2 only. This milestone no longer touches sandboxes,
the tool catalog or the filesystem, so it is small, self-contained, and can be
pulled forward whenever it is wanted.

### M11 — Chats and agent-to-agent

Per `prototype/docs/plans/agent-to-agent.md`: blocking calls, one thread per
pair, threads read-only, no unread, no request record — now sharing M4's chain
and cap. Restate in the code comment why blocking is safe here (a 60s timeout,
well inside Flue's one-hour submission timeout) and unsafe for a human confirm.

This milestone writes the v2 chats primer, which is where the plan's §8
deferral finally lands in this repo.

### M12 — Tool implementations and the MCP gateway

The verbatim lifts M6 deferred, now that the catalog, the credential shapes and
the confirm-gate exist to receive them. Each is a `ToolDescriptor` (or an MCP
registration) slotted into the registry built in M6 — no new architecture, just
the concrete integrations:

- **Firecrawl** — `org-key`. The simplest lift, and the template for a
  static-key tool.
- **Gmail / Calendar / Slack** — `oauth`. An admin configures the app
  (clientId/secret); each user runs the OAuth dance and the server stores a
  refresh token. Lift `google-auth.ts` and the OAuth callback path.
- **GCP** — `org-key-user-grant`. A shared service account, per-user access
  grant, per the prototype's service-account-only boundary.
- **Docker sandbox** — `none` with a runtime probe (is the daemon up). Lift
  `docker-sandbox.ts` and the sandbox pool.
- **The MCP gateway** — Sentry, Notion and any MCP server: per-user OAuth with
  server-advertised endpoints (the automatic-grant flow). Lift `mcp-gateway.ts`,
  `mcp-oauth.ts`, `mcp-server-store.ts`, with the tenant seam added to the
  registration store.

Gated ones (sending mail, posting to Slack, deleting) declare `gated: true` and
inherit M7's confirm-gate for free.

#### Teams — a tool-grant layer, built with the first tool (decided mid-build)

The operator wants **teams** (not organizations) so different teams get
different tool grants. This is an **authorization layer on tool availability,
not a data-isolation boundary** — the tenant seam (tenant = a better-auth user,
`rejectForeignSession`, every store's `WHERE tenant_id`) does not move, and
"org" scope stays install-wide. So it is cheap relative to multi-org, and it is
built here rather than bolted on, because its entire payload is these tools.

Three coordinator tables (not better-auth's org plugin, which drags in the org
concept we do not want): `teams(id, name)`, `team_members(team_id, user_id)`
(many-to-many — a user may be on several teams), and
`team_tool_grants(team_id, tool_name)`. Resolution: where the agent attaches its
granted tools (`attachGrantedTools`), intersect the agent's `tools` with the
**union** of the owner's teams' grants — a tool the team lacks is simply not
offered, the same "skip what the owner can't use" rule the credential shapes
already apply. Built-in tools (jobs, files, memory, routines, skills, search,
`ask_agent`, attention) are always available and never gated by a team.

Scoped for now: **allow-lists only**. Shared credentials stay org-wide (one
Firecrawl key for the install); a team-scoped _credential_ dimension is a later
add. Open sub-question to settle when building: the default for a user on **no**
team — permissive (all catalog tools) or restrictive (none until placed on a
team).

**This precedes the UI on purpose:** the settings screens configure these
credentials and connections, so the UI has nothing to render until the APIs
behind them exist.

### M13 — UI and the admin surfaces

Everything the operator sees, built against APIs that now all exist. The design
is already done (the prototype's `design/` and `ui.md`), so this is assembly,
not exploration: sign-in and chat, the job board and timeline, the attention
board and approve/deny, routines, files and the shared space, the tool catalog
and credential connections, and the admin surfaces unique to v2 — the spend
page, accounts and roles, the org tool catalog. The desktop shell (see below)
wraps this same UI and lands alongside it.

**Job board — subjobs are nested, not top-level.** A job that spawns children
(`job_spawn`) currently puts them in the flat `GET /api/jobs` list, which clutters
the board. The board should show **top-level jobs only** (`parentId === null`) and
surface a job's children on **its own detail page** — the data model already
supports this with zero server change: every `Job` carries `parentId`, and
`GET /api/jobs/:id` already returns its `children`. A child must still appear in a
**"currently running"** view (all non-terminal jobs, regardless of parent), so a
spawned job in flight is never invisible. If the flat list turns out to send too
many children to the client on a large history, add an optional `?top_level=1`
filter to the board query — but that is an optimisation, not a requirement; the
partition is derivable client-side today.

### M14 — File labels

One idea: a file carries **labels** — a `string[]` of topics, modelled on
`agent_memory.contexts` — so "look for new files about X" is a query, not a
folder walk. Labels are many-to-many (a file is `taxes` and `2025` and
`client-acme` at once), which a single-parent tree cannot express; a folder view,
if ever wanted, is a later group-by-label read over the same data, not a
different model. We chose labels over folders deliberately: the use case is
retrieval by topic, and topics cross-cut.

**Model.** A `labels` array on the file — inline JSON on the row to start; a
`file_labels(file_id, label)` side table only if a label query turns out slow.
Set at upload/creation, editable after, tenant-scoped like every file. The
`file.created` event carries the labels, so a routine can subscribe to "a new
file tagged `invoices`" and open a job — the same bus loop M4/M5 already close.

**Tools.** `list_files` gains an optional `label` (and `since`) filter, so "new
files on topic X" is one call. A `label_file` tool — or a `labels` parameter on
the file-writing path — lets an agent tag what it produces. `search` stays
content-based (FTS5); labels are the explicit-topic complement and the only
handle on binaries FTS cannot index.

**UI.** A label-chip filter on the Files screen and a label editor on a file. A
"group by label" view is optional and purely a read over the same rows.

Lift: extend `coordinator/files.ts` (the labels column + filter),
`tools/file-tools.ts` (the `list_files` filter and a labelling tool), the
`file.created` payload, `protocol/files.ts` (the `labels` field), and the Files
screen.

**Done when** an operator or agent labels a file; `list_files({ label })` returns
only that topic; a routine subscribed to `file.created` for a label fires when a
matching file lands; and the tenant-isolation tests still hold with labels in
play.

### M15 — Plugins (tools, integration types, toolset types)

Port the prototype's `@staff/plugin-core` and extend it. The prototype's plugin
adds **tools only** — a `{ id, tools: ToolDefinition[] }` bundle registered with
`addPlugin()` before boot, collision-checked on id and tool name. The load-bearing
idea carries over verbatim and dictates everything below: a plugin hands the
server **plain descriptors, never `useTool` calls**, because `useTool` reads a
render frame in `@flue/runtime`'s module scope and a separately-installed plugin
has its own runtime copy — so a plugin that attached anything itself would attach
into the wrong frame. The plugin passes data; the _server_ does the render-time
`useTool` / `useSandbox` / `attachCompactTools`.

**The extension.** A `StaffPlugin` grows two more optional arrays beyond `tools`:

- `integrationTypes: IntegrationTypeDef[]` — new providers. `integrations.ts`
  already models a type richly (type, kind, configFields, `defaultScopes`,
  `unlocks`, `oauth` {buildAuthUrl, exchange}, `bearer`). Today the registry is a
  hardcoded `TYPES = [GOOGLE, SLACK, DOCKER, GCP, FIRECRAWL]`. Make
  `integrationTypes()` / `getIntegrationType()` merge the built-ins with the
  plugin-contributed ones, so a plugin's provider is connectable in Settings and
  authorizes MCP/tools through the same generic OAuth path.
- `toolsetTypes: ToolsetTypeDef[]` — new toolset **kinds**. Today
  `ToolsetKind = z.enum(["mcp","sandbox"])` and `staff-agent.ts` dispatches the
  kind by hand (mcp → `attachCompactTools`, sandbox → `useSandbox`). Replace that
  hand-dispatch with a **toolset-type registry** keyed by kind: each type is a
  driver that, given a granted toolset's config, returns plain data the server
  attaches at render (tool descriptors, or a sandbox factory) — the same
  descriptor-crosses-runtime discipline as tools. `ToolsetKind` opens from a
  closed enum to a string validated against the registry (built-ins + plugin
  kinds).

**Boot seam.** Port the prototype's `server-lib.ts`: a deployment's entry file
calls `addPlugin()` (re-exported from `@staffroom/plugin-core`, a single shared
instance outside the server's externalized Flue bundle) before `startServer()`.
Plugins read their own config (keys, endpoints) from `process.env` at call time;
the deployment owns that environment, the public server never loads it.

**Guards.** `addPlugin` fails the boot loud on a duplicate plugin id, a tool-name
collision (as today), and now a duplicate integration `type` or toolset `kind`
against a built-in or another plugin — a silent shadow of a built-in provider is
worse than a stopped boot.

Lift: `@staff/plugin-core` and `server-lib.ts` verbatim, then extend the
`StaffPlugin` shape; open `protocol/toolsets.ts`'s `ToolsetKind`; make
`integrations.ts` and the `staff-agent` toolset dispatch registry-driven.

**Done when** a plugin adds a tool an agent can call; adds an integration type an
admin can connect in Settings and grant; adds a toolset type a member can be
granted and render with; every collision (id, tool, integration type, toolset
kind) fails the boot; and the tenant-isolation tests still hold with a plugin
installed.

---

## Part 3 — Sequencing

```
M0 → M1 → M2 ─┬─ M3 → M4 → M5 ─┬─ M6 → M7 ─┬─ M11 → M12 → M13
              │                 │           │
              ├─ M8 → M9 ───────┴───────────┘
              │
              └─ M10 (independent; slot in anywhere)
```

**Reordered mid-build: UI (M13) now comes before the integrations (M12).** The
original reasoning — settings screens have nothing to configure until the
integrations exist — was backwards. The integrations (OAuth flows, connection
tests) cannot be verified without a UI to _initiate_ them: you cannot complete a
Google consent flow or connect a Notion workspace from curl. So the UI is built
first, against the APIs that already exist, and becomes the **test harness** the
integrations are then built and verified against. M12 and M13 swap; the numbers
stay put to avoid churn.

- M2 must precede everything that spends tokens. Cost not recorded now cannot be
  backfilled.
- M3 precedes M4 (a subscription opens a job) and M7 (a deadline cancels an
  approval).
- M6–M7 and M8–M9 are genuinely parallel; nothing in what agents _know_ depends
  on the tool catalog.
- M10 depends on nothing past M2 now that skills are rows. It is the smallest
  self-contained milestone here and a good one to drop into any gap — or to hand
  to someone working in parallel.
- M11 depends on M4's chain.

## Part 4 — Risk register

| Risk                                                              | Where it bites                   | Mitigation                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A read missing `WHERE tenant_id = ?`                              | Silent: shows a colleague's data | `defineTenantIsolationTests` in every store's test file, written in M1                                        |
| A client naming another tenant's session key                      | M1, the `/agents/:id` route      | `rejectForeignSession` before Flue admission; tested by hand-composed request                                 |
| A confirm-gate that blocks instead of suspending                  | M7                               | Assert the submission _settles_ on a gated call, not just that the tool returned                              |
| A skill row Flue rejects bricks _every_ render for that agent     | M10                              | Mirror Flue's name/description validation in the protocol schema; skip an invalid row at mount with a warning |
| An agent-authored `allowedTools` routing around the confirm-gates | M10, undoing M7                  | Refused at three layers: the tool's input schema, the API's role check, and the mount                         |
| One crash domain, team-wide pauses                                | Operations, from M1 onward       | Accepted and recorded. Reversible additively — supervisor plus proxy, no store rewrite                        |
| Non-model spend invisible                                         | M2's page                        | Stated on the page itself, not just in a doc                                                                  |

## Not yet in the build order

**The desktop app.** The prototype ships one (`packages/desktop`, Electron),
and it is not a nicety: it is what reads `~/.codex/auth.json` off the operator's
own machine for the credential import (decision 3b), and the natural home for a
self-hosted single-user install. The milestones above are all server and
protocol; the desktop shell wraps the same UI.

**Sequenced last, after M14 and M15** _(decided 2026-09-05)_. It wraps a UI that
is already complete, so nothing about file labels or plugins depends on it and
nothing about it changes if those land first — but both add operator-facing
surface (a label filter; plugin-contributed integration/toolset types in
Settings) that the desktop shell should wrap once, not twice. The native
better-sqlite3 dependency (per-platform prebuilds) is a cost that lands here, not
before.

## Open questions after this plan

1. ~~better-auth on `node:sqlite`~~ — **answered**: supported directly. Confirm
   empirically in M1.
2. **Non-model costs are invisible.** Unchanged; label the spend page.
3. **One crash domain.** Accepted price, reversible.
4. ~~Depth cap value~~ — **proposed**: 5, shared with the job tree cap.
5. ~~How raw memories get written~~ — **proposed**: a tier argument on the
   existing write tool, defaulting to raw. Confirm at M9.
6. **New:** does a `:` in a Flue instance id survive routing, the React client
   and the store cleanly? Cheap to check; check it in the first hour of M1,
   because the fallback (a different separator) is free then and a migration
   later.

---

## Part 5 — Build status (2026-09-05)

The milestones above are the plan as written. This is what the code is, after
several mid-build detours. When Parts 0–4 and this section disagree, this wins.

_Reconciled against the code file-by-file on 2026-09-05. All of **M12** (teams,
Docker sandbox, `delegate`, GCP, MCP spill-to-file, MCP confirm-gating) has
landed since the previous 2026-09-04 pass and moved from "Remaining" to "Done".
**M14 (file labels)** and **M15 (plugins)** have since been built too. The only
milestone left is the **desktop app**._

### Done

**M0–M11 in full.** Skeleton; auth + tenant isolation (`rejectForeignSession`,
`defineTenantIsolationTests`); audit + spend as columns; jobs with deadlines and
the tree caps; the bus + routines-as-subscriptions; files with `file.created`;
the tool catalog + the five credential shapes + AES-at-rest; attention +
confirm-gates; FTS5 search; memory; skills-as-rows; agent-to-agent; and — new
this pass — **multiple chats per agent** (main + side, tabs, history, unread and
at-work state, jobs reporting to their origin chat).

**M12 in full.** The tool-grant layer and every integration the plan deferred:

- **Teams.** Tables `teams`, `team_members`, and — named `team_grants` in the
  schema, not the plan's `team_tool_grants` — plus a **second gate,
  `team_integration_grants`, the plan did not anticipate** (a toolset must be
  granted _and_ its integration granted). The intersection runs in
  `attachCompactTools` (`tools/compact-tools.ts`) and the sandbox attach in
  `staff-agent.ts`, **not** in `attachGrantedTools` (the legacy direct-mount
  path bypasses team gating, but staff-agent no longer uses it). **A user on no
  team resolves to the empty set — the restrictive default**, which closes the
  open sub-question in §M12.
- **Docker sandbox.** `SandboxDriver` + pool (one container per conversation),
  `--network none`, a boot-time daemon probe, mounted with `useSandbox()` at
  render. It is a `sandbox` toolset kind, not a grantable integration.
- **`delegate`.** A harness-seeded child that inherits the parent's tools and
  sandbox, depth-capped at 4.
- **GCP.** An org-wide service-account key minted into a bearer token, gated by
  team grant — the `org-key` shape in practice, not the per-user OAuth the plan
  labelled `org-key-user-grant`.
- **MCP spill-to-file.** Results over ~8 KB spill to `/work/mcp/…` in the
  sandbox and return a pointer + preview; truncation is the fallback when no
  sandbox is attached.
- **MCP confirm-gating.** MCP calls route through M7's one-shot gate: a
  per-toolset `gatedTools` list drives `needsApproval`, and `invokeGated`
  (`confirm-gate.ts`) suspends the turn exactly as local gated tools do.

**Most of M13.** Every operator screen exists: sign-in, chat, the job board
(with the nested-subjobs partition — top-level list plus a "working now" view),
the attention board, routines, files, skills, spend, accounts & roles, the tool
catalog and credential/integration connections, and a `/design` doc page. Built
against the APIs as they landed.

**M14 file labels.** Files carry `labels: string[]` (inline JSON on the row,
migration `024-file-labels`), set at upload/creation and editable after —
tenant-scoped like every file. The agent tools: `save_artifact` takes `labels`,
`list_files` takes `label`/`since` filters, and a new `label_file` retags an
owned file (owner-only, like sharing). The operator side: labels on upload, a
`POST /api/files/:id/labels` edit route, and a label-chip filter plus an inline
label editor on the Files screen. `file.created` now carries the labels, and
**the bus matcher was generalized to match an array field by membership** — so a
routine can subscribe to `where: { labels: "invoices" }` and fire on a matching
file, closing M14's last done-criterion.

**M15 plugins.** A new `@staffroom/plugin-core` package holds the plugin
contract and a single shared registry; a `StaffPlugin` contributes **tools**,
**integration types**, and **toolset kinds**, each merged with the built-ins.
Plugins pass plain data, never `useTool` calls, so they cross runtime copies.
Tools join the catalog as no-credential descriptors (`registry.ts`); integration
types merge in `integrations.ts`; and — the invasive part — the render's
hand-written sandbox/mcp dispatch became a **kind-keyed toolset-type registry**
(`tools/toolset-types.ts`), so `ToolsetKind` opened from a closed enum to a
registry-validated slug and a grant is now the generic `<kind>:<name>`. Plugins
load only through a **custom server-mode entry** (`server-lib.ts`, exported as
`@staffroom/server/lib`): `addPlugin(...)` then `startServer()`; the default
`node dist/server.mjs` runs with none. Collisions fail loud — plugin-vs-plugin
at `addPlugin`, plugin-vs-built-in at boot (`plugins.ts:assertPluginsCompatible`).
Primer: `plugins.md`; a worked deployment: `examples/custom-plugin-example/`.

### Detours (the plan does not mention these)

1. **An Integrations layer.** Above per-tool credentials sits a provider concept:
   an admin registers one OAuth app (Google, Slack) and each user connects their
   own account. Per-tool `oauth` credentials are keyed off the integration, and
   the same per-user token now authorizes MCP connections
   (`integrationBearer`). This is the "auth" half; "which tools" is separate.

2. **Tool compaction.** Built-in tools are always mounted in full; every _other_
   granted tool — the credential-backed catalog and all MCP tools — is listed one
   line each and reached through `describe_tool` / `call_tool`, so schemas stay
   out of the prompt until used. `attachCompactTools` replaced the direct-mount
   path. This is a new architecture, not in any milestone.

3. **Memory redesigned.** The three prompt tiers (raw/digested/pinned) of M9 were
   replaced with a tool-retrieved **agent archive** — knowledge is fetched through
   tools, never injected into the prompt, so changing it cannot invalidate the
   prompt cache. `agent_memory` table; migration 011 retired the old one.

4. **Direct Gmail/Calendar/Slack read tools removed; they go through MCP now.**
   `slack_read`/`gmail_read`/`calendar_read`/`http_request`/`send_message` were
   built and then deleted. The catalog is down to `firecrawl_scrape`;
   `current_time` became a built-in. The Google and Slack _integrations_ stay —
   they authorize the MCP connections.

5. **MCP gateway simplified.** Built as an org-wide `mcp_servers` registry +
   per-server tool selection, folded into the compact gateway. Auth rides the
   Integrations layer (a server names an integration; the caller's own token
   authorizes it) — so **the prototype's `mcp-oauth.ts` DCR/PKCE flow was _not_
   ported**. Large results truncate (no sandbox to spill to yet).

### Remaining

**From M12: done** — see the Done section above. Two small residues sit inside
M12's scope and are worth stating rather than losing:

- **Gated send actions have a mechanism but no defaults.** Any tool can be
  gated (a per-toolset `gatedTools` list, a per-descriptor `gated` flag), but
  nothing auto-marks known-destructive tools (Gmail `trash_*`/spam, Slack send)
  as gated — it is entirely the admin's choice per toolset. Out-of-the-box
  gating for destructive tools, if wanted, is a follow-up, not a bug.
- ~~**A stale comment** at `tools/compact-tools.ts:35`~~ — **fixed** during M15's
  compact-tools refactor; the `CompactEntry.needsApproval` doc now matches the
  implemented MCP gating.
- **Drive** — parked (no access yet).

**From M13:**

- **The desktop app** (Electron; reads `~/.codex/auth.json` for the credential
  import) — now **sequenced last, after M14 (file labels) and M15 (plugins)**, so
  its shell wraps their operator-facing surface once. Not built. The server side
  is already ready for it: `credential-routes.ts` accepts a posted `auth.json`
  and today serves only the browser-upload path
  (`ui/src/screens/Settings/ModelCredentials.tsx`); the desktop client that
  would read the file off the operator's own machine is the missing half.

**Cross-cutting:**

- ~~**Per-milestone v2 primers still owed.**~~ **Done** — architecture, tenancy,
  jobs, events-and-routines, files, tools-and-credentials, confirm-gates, memory,
  search, skills, agent-to-agent, audit-and-cost, and **chats** are all written.
- ~~**Attention is agent-scoped, not chat-scoped.**~~ **Done** — `AttentionRow`
  now carries `session`; a chat filters its pending cards by `chat.session`, so a
  gate tripped in one chat no longer shows on all of an agent's chats, and the
  attention board links each item to the exact chat it came from.
- ~~**The M1 transport test is still owed.**~~ **Done** — `tests/transport.test.ts`
  proves a streaming agent request survives the pipeline (own agent admitted with
  a `:` in the path and a cookie, streamed through; foreign 403; no-cookie 401;
  unparseable 400), against a streaming stub router.

**Planned (new, agreed 2026-09-05):**

- **File labels (M14).** **Built** — see the Done section above. Files carry a
  `labels: string[]` (topics), modelled on `agent_memory.contexts`, so an agent
  can be told "look for new files about X" and answer it as a query —
  `list_files({ label, since })` — rather than a folder walk. Chosen over folders
  because topics cross-cut (many-to-many) and it composes with the `file.created`
  bus event and FTS search. Full spec in [M14](#m14--file-labels).
- **Plugins (M15).** **Built** — see the Done section above. `@staffroom/plugin-
core` (`addPlugin()` + the `StaffPlugin` contract) contributes tools,
  integration types, and toolset kinds; the render's hand-dispatch became a
  toolset-type registry and `ToolsetKind` opened to a registry-validated slug.
  Plugins pass plain data, never `useTool` calls, so they cross runtime copies,
  and load only through the custom `@staffroom/server/lib` entry. Full spec in
  [M15](#m15--plugins-tools-integration-types-toolset-types).
