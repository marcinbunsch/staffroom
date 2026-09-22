# Primers

One document per domain: the standing explanation you read _before_ touching
that area. Not API reference — the concepts, the decisions, and where the code
lives. Commit messages capture one change; a primer captures how a whole area
thinks.

These describe **v2 as built** (this repo). Staffroom grew out of a single-user
prototype that is not part of this repository and is not public; where a
document refers to `prototype/…`, that is the local reference checkout, and the
path does not resolve here.

## The primers

- [`architecture.md`](architecture.md) — the whole system: packages, the request
  pipeline, the tenant seam, the databases, how a request flows. **Start here.**
- [`tenancy.md`](tenancy.md) — the session key, the guard, the isolation
  contract; why the tenant rides in the key and nowhere else.
- [`jobs.md`](jobs.md) — what a job is, the state machine, job sessions, the
  tree, deadlines, the dispatcher seam.
- [`events-and-schedules.md`](events-and-schedules.md) — the bus, the matcher, the
  causation chain and depth cap; schedules as subscriptions.
- [`files.md`](files.md) — one file concept, bytes on disk, visibility, the file
  events on the bus.
- [`tools-and-credentials.md`](tools-and-credentials.md) — the catalog, the five
  provisioning shapes, render-time credential binding, the offer-or-not rule.
- [`confirm-gates.md`](confirm-gates.md) — attention and approvals; why a gated
  tool suspends the turn rather than blocking it.
- [`memory.md`](memory.md) — external, agent-owned knowledge archives and retrieval.
- [`search.md`](search.md) — FTS5 over readable files, tenant-scoped, bm25.
- [`skills.md`](skills.md) — skills as rows, mounted with `useSkill()`, and the
  three rules that keep a bad row from bricking a render.
- [`agent-to-agent.md`](agent-to-agent.md) — a question as a blocking tool call;
  threads, the timeout, no request record.
- [`chats.md`](chats.md) — many conversations per agent; the stored session, the
  one-main invariant, the bare-key adoption trick, and live unread/activity.
- [`audit-and-cost.md`](audit-and-cost.md) — the `observe()` tap, cost as
  columns, the spend page.
- [`plugins.md`](plugins.md) — how a deployment adds its own tools, integration
  types, and toolset kinds; the plain-data contract and the server-mode entry.

## House style

Match `architecture.md`. In short:

- **Lead with the idea, then the mechanism.** Say what a thing _is_ and why it
  earns its place before how it works.
- **Record decisions, especially the roads not taken.** The most valuable line
  in a primer is often "we did X rather than Y, because Z." That reasoning is
  invisible in the code.
- **Name the file where each thing lives**, as `path:symbol`, so the primer is a
  map into the code.
- **Be honest about limits and gaps.** A primer that hides a sharp edge is worse
  than none.
- Prose, not bullet soup. Tables where a mapping is genuinely tabular.
