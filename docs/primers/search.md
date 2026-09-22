# Search — a primer

Keyword search over files an agent can read. Agent memory uses a separate,
owner-scoped index and is available only through the memory tools.

It is deliberately modest: SQLite FTS5, tenant-scoped, ranked by bm25. No
service, no embeddings, no second process. The whole thing is one virtual table
and about a hundred lines. This primer is about why that is enough, and where
the edges are.

## The one idea

There is a single full-text index — `search_index`, an FTS5 virtual table — and
the files store keeps it current. It indexes a text file's body when the file is
written and drops it when the file is deleted. Searching is then one statement: a `MATCH` against the index,
filtered to the caller's `tenant_id`, ranked by `bm25()`. There is **no derived
store beyond the index itself** — no separate "searchable copy" of a file, no
sync job, no cache to invalidate. The index _is_ the searchable copy, and the
store that owns the content owns keeping it right.

The store lives in `coordinator/search.ts:SearchIndex`, with three methods:
`index()` to add or replace a row's text, `remove()` to drop it, and `search()`
to query. The virtual table is created in `coordinator/migrations.ts` under
`008-search`. The wire types are in `protocol/src/search.ts`.

## bm25, and why lower is better

FTS5 ranks with `bm25()`, and its convention is the one that trips everyone:
**a lower score is a closer match.** So `search()` orders ascending and the
first row is the best hit. `SearchHit.score` carries the raw bm25 number and the
doc comment on it says so, because a caller sorting the other way would put the
worst result on top. bm25 rewards density — a term that is most of a short
document beats the same term buried in a wall of unrelated text — which is the
behaviour the ranking test pins.

Each hit also carries a `snippet`: a short excerpt around the match, produced by
FTS5's own `snippet()` (bracketing the matched term, capped at a dozen tokens).
That is what the agent tool and the UI show so a person can see _why_ a document
matched without opening it.

## The one raw-SQL store

`SearchIndex` is the single coordinator store that talks to the connection in
raw SQL rather than through Kysely's typed query builder. That is not a
shortcut — **FTS5 is not exposed through Kysely's typed builder** (`MATCH`,
`bm25()`, `snippet()`, the virtual table itself have no builder surface), so a
typed query cannot express the one query search needs. The raw queries are
kept small, fixed, and fully parameterised; user input only ever arrives as a
bound `?`, never as string-built SQL. Everywhere else in the coordinator, reach
for Kysely; here, and only here, the raw connection is the right tool.

The columns split by role. `kind`, `ref_id` and `tenant_id` are stored
**UNINDEXED** — they filter and identify a hit, they are not themselves
searched. `title` and `body` are the searchable columns. Keeping the identifiers
out of the FTS index means a query can never accidentally match on a tenant id
or a file id, and the index stays lean. FTS5 has no upsert, so `index()` is a
delete-then-insert inside a transaction — that is why a re-index replaces a
row's text rather than duplicating it.

## Query safety: you cannot write it wrong

A raw user query is not a safe FTS5 expression. FTS5 gives `"`, `*`, `AND`,
`OR`, `NOT` and `column:` their own meanings — so `answer*` is a prefix search,
`col:val` is a column filter, a lone `"` is a **syntax error**, and `AND OR NOT`
either changes what the search means or throws. A search box that fed its input
straight to `MATCH` would surface FTS5's grammar as user-visible failures.

So `toMatchQuery()` refuses to trust the query as an expression. It tokenises
the input to alphanumeric runs (Unicode letters and numbers) and wraps each run
in quotes, joining them with a space. FTS5 reads space-joined quoted terms as
**implicit-AND, one phrase per term** — every term must appear, each treated as
a literal, none as an operator. The result is a query that _cannot be written
wrong_: no input can be a syntax error and no operator can leak through. This is
the same posture as the event matcher's equality-only rule (see
`events-and-schedules.md`) — take away the expressive footgun rather than try to
sanitise around it. A query that tokenises to nothing (empty, whitespace, or
symbols only) returns no results at all.

## File search only

`SearchKind` is `'file'`. Files feed the index on write and un-feed it on delete.
The separate agent-memory archive has its own FTS5 table because its privacy
boundary is `(tenant, agent)`, rather than the file index's tenant boundary.

- **Files** feed the index on write and un-feed it on delete. A _text_ file is
  indexed by its body; a **binary file is indexed by name only** — its bytes
  never enter the index, which the search test verifies by planting a marker in
  a PNG and confirming it does not match. (See `files.md`.)

## Who calls it

Two callers, both tenant-scoped by construction:

- `tools/search-tool.ts` gives every agent a `search` tool. It needs no
  credential and is never gated — reading your own content is not a privileged
  act. It binds the caller's `tenantId` at render time (the tool cannot see its
  caller otherwise; see `architecture.md`), searches files, formats the
  hits as a short list of `[kind] title (refId)` lines with snippets, and says
  so plainly when nothing matches.
- `search-routes.ts` serves `GET /api/search` for the UI's search box, reading
  the tenant from the session's caller and an optional `kind` query param.

Neither can reach across tenants: `tenantId` is a `WHERE` clause in the one
query, taken from the session, never from user input. The isolation test plants
two tenants' documents with identical text and confirms a search sees only its
own.

## Limits, and the road not taken

The limit is clamped: `search()` defaults to 20 and caps at 100
(`clampLimit()`), so no caller can ask the index for an unbounded scan. The tool
asks for 10, the route for 25.

The larger omission is deliberate: **there are no embeddings, and no semantic
search.** The reason is concrete rather than principled — the Codex login this
project runs on grants no embedding endpoint, and semantic search would need
either a separate API key or a local ONNX model, and neither earns its keep
before keyword search has been used in anger. Keyword search has a real blind
spot: it misses paraphrase. "Find what I wrote about the auth rewrite" will not
match a file that discussed the same work in other words. When that blind spot
starts to hurt, add a vector backend alongside the file index without
disturbing the existing keyword path.

FTS5 itself is not exotic here: it is verified working under **better-sqlite3**,
whose bundled SQLite (3.53.4) ships the FTS5 extension compiled in, so there is
nothing to enable at runtime.

## Where to go next

`files.md` for the files that feed this index, and `memory.md` for the separate
agent-memory archive.
