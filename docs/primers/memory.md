# Agent memory — a primer

Memory is an agent-owned, durable knowledge archive: the place for useful
facts, decisions, lessons, statuses, and references that should survive a
conversation. It is not conversation history or a project filesystem. Relevant
records are retrieved automatically as bounded evidence beside a new operator
or job delivery, while the full archive remains available through tools.

That distinction is the design. The system prompt contains stable identity and
operating instructions; an archive can change frequently without changing that
prompt or invalidating its cache. A briefing is written once as a durable
conversation signal beside the delivery that caused it; a later turn replays
that exact historical signal rather than recomputing old prompt history. Memory
is evidence, not an instruction to follow: stored text can be stale, wrong, or
adversarial.

## One archive per agent

Every memory operation is scoped by the pair `(tenant, agent)`. Both values are
bound while `agents/staff-agent.ts:StaffAgent` renders the tools from its
resolved session; the model cannot provide or override them. An agent can work
on many customers or projects, so `contexts` are only lightweight retrieval
labels, never an ownership or access boundary. For example, an agent might tag
an entry `acme` and `auth`, but it still belongs to that one agent's archive.

There is no sharing mode. Unlike files, a memory entry is not promotable to the
organization; another agent has neither a tool nor a query path to read it.
This makes memory appropriate for an agent's accumulated working knowledge,
not a replacement for a report or other shared artifact.

`coordinator/migrations.ts:011-agent-memory` deliberately removed the old
raw/digested/pinned `memory` table rather than migrating it. That table was
prompt state with different ownership and retrieval semantics. Carrying it
forward as if it were this archive would have made the new model's privacy and
provenance claims untrue.

## Entries are records, not mutable notes

`protocol/src/memory.ts:AgentMemoryEntry` defines an entry. Its immutable `id`
identifies one version; `kind` is one of `fact`, `decision`, `lesson`, `status`,
or `reference`; and `title` and `body` are its human-readable content. Entries
also carry optional `key`, `contexts`, `source`, timestamps, `version`,
`supersedes`, and a `status` of `active`, `superseded`, or `retracted`.

Most entries are unkeyed: a standalone lesson can simply be saved. A `key`
names a living slot, such as `acme.auth-architecture`. Writing that key again
does not update the row in place. `AgentMemoryStore.update()` marks the prior
active row `superseded`, removes it from the search index, and creates a new
active row with a new id, a higher version, and `supersedes` pointing backward.
The unique partial index on `(tenant_id, agent, key)` for active rows enforces
the one-current-value rule even outside the store's normal path.

An update by id has the same versioned behaviour. A historical id cannot be
made current again: fetch the current entry first, then update that. Callers
may send `expectedVersion`; a mismatch (or an attempt to update a non-active
entry) raises `MemoryVersionConflictError` instead of silently replacing
knowledge the caller has not seen. This is deliberately lightweight optimistic
concurrency, not editing locks.

`forget()` is retraction, not deletion. It changes only an active entry to
`retracted` and removes its FTS row, preserving the record and its audit trail.
Neither superseded nor retracted entries can appear in normal search or list
results, though a known id can still be read through the store/API. Sources say
where a version came from: agent tool writes record the session id, while
operator writes record `operator`.

## Retrieval is message-adjacent and keyword based

The archive has its own SQLite FTS5 table, `agent_memory_search`, created with
the `porter unicode61` tokenizer. It indexes title and body; id, tenant, and
agent are unindexed fields used to identify and constrain results. It is
separate from `search_index`, whose visibility model is tenant-scoped readable
files (`search.md`). The separation matters: a file search must never discover
an agent's private memory.

`AgentMemoryStore.search()` tokenises arbitrary input into Unicode letter and
number runs, quotes every term, and joins them as an implicit-AND FTS query.
This prevents FTS syntax and operators from leaking out of a search string; an
empty or symbols-only query yields no results. Results are ranked by FTS5
`bm25()` ascending (lower is better), given FTS5 snippets, and capped at 20
(default 8). The store fetches extra ranked candidates before applying optional
kind and context filters. Multiple requested contexts are an AND filter: an
entry must have every label.

Only active entries stay in the index. Creating a version removes its
predecessor before indexing the new body; retracting an entry removes it too.
There is no embedding or semantic retrieval, and no background summariser or
sync job. The trade-off is intentional simplicity, with the familiar keyword
blind spot for paraphrase.

For each operator message and job delivery, `attachMemoryContext()` searches up
to five matching records and then fills any remaining briefing slots with current keyed slots,
up to five entries and 6,000 characters total. Each record names its immutable
id and version and is wrapped as quoted evidence. The briefing becomes a hidden
`memory-context` signal immediately after that delivery, before the model reads
it. It is durable: editing memory later affects only future deliveries, keeping
the preceding conversation prefix stable for prompt caching and audit.

If the task changes during a turn, the agent can call
`refresh_memory_context`. Its durable tool result explicitly supersedes earlier
retrieved context for that task. An operator can simply send a new message to
refresh automatically; a hard context reset is a new conversation, never a
rewrite of existing history.

## The agent tools

`tools/memory-tools.ts:attachMemoryTools` gives every ready staff-agent five
ungated built-ins, all bound to its own archive:

- `memory_search` searches active entries by query, and can narrow by kinds,
  context labels, and limit. It returns ids, kinds, titles, and snippets.
- `memory_get` reads a known id in full. The search-then-get flow keeps a large
  archive out of an ordinary turn.
- `memory_update` creates an entry, versions an id, or replaces a keyed current
  slot. It rejects an ambiguous call that supplies both id and key.
- `memory_forget` retracts an active entry that is wrong or no longer useful.
- `refresh_memory_context` returns the same bounded evidence briefing for a
  changed mid-turn task, superseding earlier retrieved context.

The tool descriptions explicitly tell the model to search before relying on a
past fact and to get an entry returned by search before editing it. These are
guidance rather than an enforced write protocol; `expectedVersion` is the
enforcement available when a caller needs to protect against a stale read.

## Operator access is a view of the same archive

`memory-routes.ts` exposes the operator API under
`/api/staff/:agent/memory`. Listing returns active entries ordered by most
recent update; getting a known id can inspect a historical version. The route
can create/version entries (with source `operator`) and retract them, using the
same store and its conflict checks as the agent tools. The tenant comes from
the authenticated caller, never from the URL or request body.

`ui/src/screens/Memory.tsx:Memory` is deliberately an archive inspector, not a
prompt editor. It lets an operator select an agent, see its active entries,
their type/key/version/labels and a body summary, and forget an entry. The
transcript hides the durable `memory-context` signals, while the model retains
them as auditable turn input.

## Where each thing lives

| Concern                                  | Where                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Wire schema and kinds                    | `packages/protocol/src/memory.ts`                                |
| Tables, partial key index, and FTS table | `packages/server/src/coordinator/migrations.ts:011-agent-memory` |
| Versioning, retrieval, and retraction    | `packages/server/src/coordinator/memory.ts:AgentMemoryStore`     |
| Agent-facing tools                       | `packages/server/src/tools/memory-tools.ts:attachMemoryTools`    |
| Durable message briefing                 | `packages/server/src/tools/memory-context.ts`                    |
| Session-bound attachment                 | `packages/server/src/agents/staff-agent.ts:StaffAgent`           |
| Operator HTTP API                        | `packages/server/src/routes/memory-routes.ts`                    |
| Operator archive screen                  | `packages/ui/src/screens/Memory.tsx:Memory`                      |
| Behavioural coverage                     | `packages/server/tests/coordinator/memory.test.ts`               |

## Where to go next

Read `architecture.md` for session-derived identity and tool binding,
`tenancy.md` for the isolation boundary, and `search.md` for the parallel FTS5
index over shared files.
