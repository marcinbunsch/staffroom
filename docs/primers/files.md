# Files — a primer

One durable, visible object that anyone can produce and anyone in the
organization can be shown. What a file _is_, where its bytes and its metadata
live, how sharing works, and the two events a file puts on the bus. Read
`architecture.md` first.

## The one concept

There is one file concept, and there has been from the start. The prototype had
two: operator uploads on one side and agent artifacts on the other. But those
were the same thing — a durable, visible object — travelling in opposite
directions. An operator hands a spreadsheet _in_; an agent writes a report
_out_. Same object, same storage, same sharing rules, opposite direction of
travel.

So this collapses them. A file has metadata in `staffroom.db`, bytes on disk at
`$STAFFROOM_HOME/files/<id>`, and a **`source`** column — `operator | agent |
job` — that records which way it was going. There is no separate artifact
store, and no text-only limitation: a file is any bytes with a content type.
The schema is `StaffFile` in `packages/protocol/src/files.ts`; the store is
`FilesStore` in `packages/server/src/coordinator/files.ts`.

An **artifact** is the first-class name for a file with `source: "agent"` and
an owning agent. It has no second store or alternate sharing rule — it is a
file with agent-work provenance. The `source` is the only trace of direction.
An operator upload also carries a
`messageId` (the chat message it was attached to); an agent- or job-written file
carries the `agent` that produced it and, for a job, the `jobId`. None of that
changes how the file is stored or read — it is provenance, not behaviour.

## Bytes on disk, metadata in the row

File bytes never live in a row. `create` writes them to `files/<id>` with mode
`0600`, then inserts the metadata row. The order is deliberate and load-bearing:
**bytes first, row second**, so a row can never point at a file that failed to
write. A missing byte-file with a present row would be a lie the rest of the
system would trust. Delete runs the other way — row, then `rmSync` — and
`remove` is proven to take the bytes with it.

Reading bytes goes back through the same visibility check as reading metadata:
`bytes(tenantId, id)` calls `get` first and returns `undefined` if the caller
may not see the file, so the disk read is never reached for a file that isn't
theirs.

## Sharing is a field, not a copy

A file has a **`visibility`** — `private` or `org` — and that is the whole of
sharing. There is no second copy, no shared-with list, no publish-into-a-folder.
The read is the same idiom credentials and skills use:

> everything I own, plus everything the org shares —
> `tenant_id = me OR visibility = org`.

`list` and `get` run exactly that predicate. Promoting a file is a flip of the
field to `org`; un-sharing is the same flip back to `private`. One file, one
version, throughout — Bob reading Alice's shared report reads Alice's row and
Alice's bytes, not a copy of them.

Two things stay pinned to the owner regardless of sharing. Only the owner may
**change** the visibility, and only the owner may **delete**. Both operations
scope to `tenant_id = me` rather than to the shared read, so an org reader who
can see a file still cannot un-share it or remove it (`setVisibility` and
`remove` both return the not-found result for a non-owner). The owner stays the
owner.

## Only a human promotes

An agent gets five file tools, in `packages/server/src/tools/file-tools.ts`:
`save_artifact`, `read_file`, `list_files`, `create_artifact_from_sandbox`, and
`save_file_to_sandbox`. The last two bridge the agent's Docker Sandbox and
durable Staffroom files in either direction, including binary files. An agent
can produce files and read anything it is allowed to read. It **cannot** promote a file to the organization —
there is deliberately no `share` tool.

`setVisibility` is reachable from the operator HTTP API
(`POST /api/files/:id/visibility` in `packages/server/src/routes/file-routes.ts`) and
nowhere else. This costs some unattended convenience: an agent that writes a
team report cannot publish it itself; a human has to. That is the point. It
closes a prompt-injection exfiltration path (§3 of the design) — a compromised
agent can write whatever it likes into its own private space, but it has no
route to push those bytes into the shared org space where the rest of the
organization would read them. Promotion is a human's judgement, by construction,
not by policy that could be forgotten.

## Two events on the bus

Files gave the event bus its second and third event types (see
`events-and-schedules.md`), and they demonstrate the scope rule that primer is
about.

- **`file.created`** fires on every write, **tenant-scoped**. Alice writing a
  file is Alice's event; only Alice's subscriptions see it.
- **`file.shared`** fires on promotion to `org`, **org-scoped**. This is the one
  place a file event deliberately crosses tenant lines — the moment a private
  thing becomes an organization thing, the whole org may learn of it.

Returning a file to private publishes nothing: un-sharing is quiet. Both events
carry the `fileId`, `name` and `visibility` in their payload and a
`source: file:<id>` so causation can be traced.

`file-bus.test.ts` proves this end to end against a real bus. An admin
"org-directory watcher" subscribed to `file.shared` opens a cataloguing job the
instant Alice promotes a file — and stays silent while the file is private,
because `create` is tenant-scoped and the admin never sees it. A `file.created`
watcher on Bob's tenant never fires for Alice's private write. The file events
ride the same bus schedules already use, with no new mechanism.

## Search: text in full, binary by name

On write, a text file is indexed for full-text search; a binary file is indexed
by its **name only** (see `search.md`). `isText` gates it — `text/*`,
`application/json`, `application/markdown`, and `+json` suffixes count as text
and have their whole body indexed. Everything else is indexed with an empty
body, so an uploaded PDF is findable by filename without dumping binary noise
into the index. The index entry is tenant-scoped like the file, and `remove`
clears it.

## Where each thing lives

| Concern                        | Where                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| The schema, source, visibility | `packages/protocol/src/files.ts` (`StaffFile`, `FileSource`, `FileVisibility`) |
| Event type names               | `packages/protocol/src/files.ts` (`FILE_CREATED`, `FILE_SHARED`)               |
| The store, bytes, sharing      | `packages/server/src/coordinator/files.ts` (`FilesStore`)                      |
| The agent's tools              | `packages/server/src/tools/file-tools.ts`                                      |
| The operator HTTP API          | `packages/server/src/routes/file-routes.ts`                                    |

## Where to go next

`events-and-schedules.md` for the bus and the scope rule these events exercise,
and `search.md` for how the file index sits inside the shared FTS5 store.
