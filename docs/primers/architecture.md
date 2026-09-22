# Architecture — a primer

The shape of the whole system: the pieces, how a request flows through them, and
where each piece lives. Read this first; the domain primers go deep on their
areas.

## The one-paragraph version

Staffroom is a single process. It hosts the agents, owns the jobs and the
schedule, keeps the audit record, and serves the web UI — all behind
[better-auth](https://better-auth.com) sessions. The CLI and the browser are
thin clients over its HTTP API. Agents are [Flue](https://flueframework.com)
functions running in that same process. Unlike the prototype it grew from, it is
**multi-tenant**: many people share one process, and a tenant is a user.

## The three big ideas

1. **Staff are data, not code.** A staff member is a row — a name, a system
   prompt, an optional model, a credential, a tool list. One Flue agent function
   (`StaffAgent`) _becomes_ whichever member a session addresses. Adding an agent
   is an insert, never a rebuild.
2. **A job is the unit of work.** When a request is more than a quick answer, an
   agent opens a job: a private session, a timeline, a deadline, caps, cost
   attribution. Reactions to events are jobs; scheduled runs are jobs. (See
   `jobs.md`.)
3. **The tenant rides in the session key.** Everything an agent turn needs is
   recoverable from `tenant:agent[...]` alone, because Flue claims work from a
   poll loop and a turn resumed after a restart has no request, no headers, no
   ambient context. (See `tenancy.md` — it is the load-bearing decision.)

## The packages

pnpm workspace, TypeScript 7, native ESM with `.ts` import specifiers.

| Package               | What it is                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@staffroom/protocol` | Zod schemas — the single source of truth for every type that crosses the wire (server ↔ CLI ↔ UI). Zero deps beyond zod. |
| `@staffroom/server`   | The Flue app: agents, tools, the coordinator, the HTTP API. Almost everything lives here.                                |
| `@staffroom/cli`      | The `staffroom` command — a thin HTTP client (a stub for now).                                                           |
| `@staffroom/ui`       | The React SPA, built to `dist/` and served by the server (a placeholder for now; M13).                                   |

The rule of the protocol package: if a type crosses the wire it is a Zod schema
in `@staffroom/protocol`, and the TypeScript type comes from `z.infer`. Validate
at the boundary, then trust it inside. Flue tool inputs are the one deliberate
exception and use **valibot** — Flue's own convention, kept separate.

## What runs where

One process, three SQLite files under `$STAFFROOM_HOME`, all through
**better-sqlite3** (a synchronous native driver; see `tenancy.md` and the
`Database` class in `coordinator/database.ts` for why synchronous):

- `flue.db` — Flue's own store: conversations, submissions, attachments. Flue's
  truth. Wired by `src/db.ts`.
- `staffroom.db` — operational data: the roster, jobs, schedules, files metadata,
  tool and model credentials, approvals, attention, memory, skills — **plus
  better-auth's own tables**, since a tenant _is_ a better-auth user and the
  thing every row points at should not live in a different file. better-auth
  gets its own connection to this file; the stores share another. (`auth.ts`,
  `coordinator/database.ts`.)
- `audit.db` — the append-only audit log, its own file so it can grow and rotate
  without touching operational data, and so the busiest writer never contends
  with better-auth for a lock. (`coordinator/audit.ts`.)

File _bytes_ live on disk at `files/<id>`, never in a row. So does the generated
auth secret and encryption key when not supplied by the environment.

## How a request flows

`create-app.ts` builds the pipeline; `app.ts` is the composition root that wires
it and runs the boot side-effects. The pipeline, in order:

1. **Boot side-effects** (in `app.ts`): run migrations, start the audit tap,
   register model providers from stored credentials, hand the jobs coordinator
   its dispatcher and terminal listener, wire agent-to-agent delivery, start the
   scheduler.
2. **Auth routes** — better-auth owns `/api/auth/*` (sign-up, sign-in, sign-out),
   necessarily ungated.
3. **The session gate** — `requireSession` resolves the better-auth session on
   every `/api/*` and `/agents/*` call and stashes the caller. This sits at the
   root because Flue drops caller headers after admission, so it is the one place
   auth can run.
4. **The data API** — one route module per domain (`api-routes`, `job-routes`,
   `file-routes`, …), each reading its tenant from the caller and never from the
   path.
5. **The agents** — `/agents/:id`, guarded by `rejectForeignSession` (the tenant
   in the path must be the caller's) then `rejectUnknownAgent`, before Flue
   admits the conversation.
6. **The UI** — anything else serves the built SPA.

## The agent

There is exactly one agent function: `agents/staff-agent.ts`. On every turn it
parses the session key into `{ tenantId, agentId, jobId?, counterpart? }`
(`resolveAgentSession` in `agents/resolve-session.ts`, a pure function so the
tenancy claim is testable), loads that member, resolves the credential that
pays, picks the model, and attaches the toolset — binding the tenant into every
tool at render time, because **Flue does not tell a tool who called it**.

The render is deliberately thin: it turns a resolution into hooks and a prompt.
All the judgement lives in `resolveAgentSession`, which takes the session key and
the stores and no ambient input — which is exactly what makes a resumed job
render the same as a live one.

## The coordinator

Everything the process owns beyond Flue lives in `coordinator/`. Each is a small
store or engine with one job:

| File                                                          | Owns                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `database.ts`                                                 | The shared `staffroom.db` connection and the Kysely/exec split. |
| `migrations.ts`                                               | The versioned, append-only schema.                              |
| `roster.ts`                                                   | The staff roster.                                               |
| `jobs.ts`                                                     | The jobs state machine, tree, caps, deadlines. The heart.       |
| `event-bus.ts` / `schedules-store.ts` / `scheduler.ts`        | The bus, subscriptions, and the clock.                          |
| `files.ts`                                                    | Files: metadata here, bytes on disk.                            |
| `tool-credentials.ts` / `model-credentials.ts` / `secrets.ts` | Credentials and encryption at rest.                             |
| `attention.ts`                                                | Confirm-gate approvals and operator attention.                  |
| `operator-profile.ts`                                         | Who each tenant works for, prepended to every agent's prompt.   |
| `memory.ts`                                                   | Each agent's external knowledge archive.                        |
| `search.ts`                                                   | The FTS5 index.                                                 |
| `skills.ts`                                                   | Agent and org skills.                                           |
| `audit.ts` / `flue-audit.ts`                                  | The append-only log and the `observe()` tap that feeds it.      |

## Three seams worth knowing

- **Inject, don't import.** The coordinator must reach agent sessions (to deliver
  a job, resume an approval, answer an a2a question) but must not import the
  agent — that is a cycle (agent → tools → coordinator → agent). So `app.ts`, the
  one module that imports everything, hands the coordinator a dispatcher at boot.
  The scheduler, the terminal listener and a2a delivery use the same seam.
- **The render binds identity.** Flue tools cannot see their caller, so
  `StaffAgent` binds `{ tenantId, agentId, jobId }` into every tool when it
  attaches them. This is also where the credential and the confirm-gate wrap in.
- **Central instrumentation, not scattered hooks.** One `observe()` subscriber
  (`flue-audit.ts`) sees every turn and tool call and records it, attributed by
  the session key's tenant — rather than wrapping each tool.

## Models and cost

Model providers come from stored credentials, not the server's filesystem: each
credential registers as its own Flue provider (`providers/registry.ts`), so a
per-tenant key works inside one process-global runtime. Flue prices every turn
against the model's own cost table; the audit tap lifts that into columns, so the
spend page is a `GROUP BY`. (See `audit-and-cost.md` and
`tools-and-credentials.md`.)

## What is not built yet

- **The UI** is a placeholder. Everything M1–M11 was verified over HTTP and the
  audit log, not clicked. M13 builds it.
- **The real external integrations** (Firecrawl, Gmail/Calendar/Slack, GCP,
  Docker, and the MCP gateway for Sentry/Notion) are deferred verbatim lifts —
  the catalog and credential architecture holds them, but they do not work yet.
  M12 lands them.

## Where to go next

`tenancy.md` for the decision the whole thing rests on, then `jobs.md`.
