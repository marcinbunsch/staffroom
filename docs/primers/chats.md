# Chats — a primer

Many conversations with the same agent, and the one idea the whole area turns
on: **a chat is a conversation, not a different agent.** A side chat with `code`
renders with `code`'s exact prompt, memory and tools — it is a second thread of
talk, not a second personality. Lives in the `chats` table (migration
`013-chats`), `coordinator/chats.ts:ChatStore`, the `__c`/`__t` suffixes in
`protocol/identity.ts`, the live-state tap in `coordinator/chat-activity.ts`, and
the `chat-routes.ts` API behind `screens/Chat.tsx` + `components/ChatTabs.tsx`.

## A chat is a conversation

An operator talks to `code` about a migration in one place and about a flaky test
in another, and wants those kept apart the way a person keeps two email threads
apart — same correspondent, different subjects. So an agent has a **main** chat
and any number of **side** chats. Every one of them resolves to the same member
row and renders identically; the only thing that differs is which Flue
conversation the turn lands in. `agents/staff-agent.ts` never reads the chat
field at all — it resolves the agent from the session key and renders, and a chat
session is just another session it serves.

The alternative — a chat as a lightweight _agent_ variant, with its own prompt or
tool set — was rejected on purpose. It would turn "open a second chat" into "fork
the configuration," and every side chat would be a place for the two to silently
drift out of sync. Keeping a chat purely a conversation means there is nothing to
keep consistent: change `code`'s prompt and all of `code`'s chats change with it,
because there is only one `code`.

## The chat is a stored row, and its session is stored too

A `Chat` is `{ id, tenantId, agent, session, title, kind, closedAt, createdAt,
lastMessageAt }` (`protocol` shape; `coordinator/chats.ts`). Tenant-scoped like
everything else. The one row that repays a second look is **`session`** — the
Flue conversation id — because it is _stored, not computed._

It has to be, because the session depends on the row's own id (`__c<id>` /
`__t<id>`), and the id is only known after the insert. `ChatStore.#insert` writes
the row with a throwaway `pending:<uuid>` placeholder, reads back the id,
computes the real session, and updates it — all inside one transaction
(`#insert`, `#session`). The placeholder is unique so it can never collide with a
real key or another pending one; by the time the transaction commits, no row ever
has a `pending:` session visible to anyone.

## Exactly one open main chat per agent

The load-bearing invariant, enforced entirely in `ChatStore`:

- **`main()` lazy-creates.** Asking for an agent's main chat when none exists
  makes it. There is no separate "create agent's first chat" step — the first
  `main()` call is it. `list()` calls `main()` first, so a tab strip always has a
  main to show.
- **`close()` and `delete()` refuse the live main.** Both throw `MainChatError`
  rather than leave an agent with no main. The main is closed only by _starting it
  over_.
- **`clearMain()` is start-over:** close the current main and open a fresh one in
  one step. Nothing is deleted — the old conversation drops into history.
- **`reopen()` always comes back as a _side_ chat** (`kind: "side"`), so a
  reopened old main can never become a second live main.

These four rules mean "one main" is true by construction, not by a check someone
has to remember to run.

## The suffix, and the bare-key adoption trick

A chat's session is an ordinary session key with a chat suffix
(`protocol/identity.ts`): `<tenant>:<agent>__c<id>` for a later main,
`<tenant>:<agent>__t<id>` for a side chat. `parseSessionKey` learns them via
`CHAT_SUFFIX = /^__(c|t)(\d+)$/`, filling `SessionIdentity.chat = { kind, id }`;
`composeSessionKey` writes them back. The regex is anchored on `c`/`t` so a chat
suffix is never confused with `__job-` or `__a2-`, and the three suffix families
are mutually exclusive: a session is a chat, a job, or a thread — never two.

The deliberate exception is the **first main chat, which has no suffix at all** —
it keeps the bare `tenant:agent` key (`#session`: a main with no other main
returns `base`). This is not a special case for its own sake; it is what lets
multi-chat land on top of a single-chat world without a migration of live
conversations. Every agent that already had one conversation had it at the bare
key. When `main()` first runs for that agent, its main chat adopts that bare key
and the existing history is simply _there_, in place, unmoved. Only the second
main an agent ever gets (after a start-over) needs `__c<id>` to stay distinct.

## Live state: a second `observe()`

Three things about a chat change as the agent works: whether it is **at work**
(activity), whether it has **unread** replies, and **when it last spoke** (which
orders history). All three are driven from one place —
`coordinator/chat-activity.ts:startChatActivity` — a _second_ `observe()` tap on
Flue's event stream, separate from the audit tap (`audit-and-cost.md`). Same
stream, different concern; splitting them keeps neither obscuring the other, and
either can fail without touching the other.

On `agent_start` it marks the session at work (`activity.ts:ActivityTracker`,
in-memory presence); on `agent_end` it clears that, `touch`es the chat's
`lastMessageAt`, and increments the unread count (`unread.ts:UnreadStore`, the
`chat_unread` table keyed by session). The whole handler is wrapped so a failure
only warns — "presence and badges must never break the run that produces them."

Crucially it **acts only on chat sessions.** A job session (`__job-`) or an
agent-to-agent thread (`__a2-`) is not a conversation the operator reads, so the
handler returns early on both (`identity.jobId`/`identity.counterpart`
undefined). A background job burning through turns lights up no chat and rings no
badge.

## Jobs report back to the chat they came from

When a job finishes, its closing summary should land in the conversation that
started it — not always the main chat. This mostly falls out for free.
`jobs.close()` dispatches to the job's `originatorSession`, and `job_open` sets
that to `context.session` — which _is_ the chat the operator opened the job from.
Start a job from a side chat and its summary returns to that side chat.

The one path that did _not_ have an originating chat was a **schedule**: it fires
from the bus, not from anyone's turn, so there is no chat in context. Left alone
it would have hardcoded the bare session. `coordinator/event-bus.ts` instead
routes a schedule's output to `chats.main(tenant, agent).session` — a schedule
reports to the agent's _main_ chat, which is the right default for unattended
work. The bus takes an injectable `chats` dependency (`Pick<ChatStore, "main">`)
so the coordinator tests can pass a real `ChatStore` without the whole app.

## The API and the UI, briefly

`chat-routes.ts` is the surface: `GET /api/staff/:id/chats` (the tab strip, with
each chat's unread + at-work flags), `/chats/history` (the closed ones), `POST
/chats` (open a side chat), `/chat/clear` (start over), and per-chat
`PATCH`/`close`/`reopen`/`DELETE`/`read` on `/api/chats/:chatId`, plus `GET
/api/chats/unread` for the roster badges.

On the client, `screens/Chat.tsx` renders one chat (route
`/a/:agentId/c/:chatId`, the bare `/a/:agentId` being the main),
`components/ChatTabs.tsx` is the tab strip (dots for at-work, `+` for new,
double-click to rename, close, start-over), and `components/ChatHistory.tsx`
lists closed chats to reopen or delete. `lib/last-chat.ts` remembers the
last-viewed chat per agent in `localStorage` so returning to an agent reopens
where you were. A side chat titles itself from its first message —
`titleFromMessage`, the first line capped at 60 chars, a plain substring and
**not** a model call. `Shell.tsx` polls `api.chats()` every few seconds so dots
and badges stay live without a socket.

## Known gap: attention is agent-scoped, not chat-scoped

`AttentionRow` carries no `session`, so a pending approval or question card
filters by **agent**, not by chat — an approval raised in one of `code`'s chats
shows on _all_ of `code`'s chats. It is a display imprecision, not a correctness
bug (the gate resolves correctly wherever you answer it), but it is the sharp
edge to know about. Closing it means projecting `session` through the attention
route and filtering the cards on it. See `confirm-gates.md` for how the gate
itself works.

## Where to go next

`agent-to-agent.md` and `jobs.md` for the other two things a session key can be —
a thread and a job — and why a chat is deliberately neither. `audit-and-cost.md`
for the _first_ `observe()` tap this one runs alongside.
