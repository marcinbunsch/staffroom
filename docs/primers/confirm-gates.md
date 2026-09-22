# Confirm-gates — a primer

Attention, approvals, and the one idea the whole area turns on: a gated tool
call **suspends the turn, it does not block it.** Lives in
`coordinator/attention.ts`, `tools/confirm-gate.ts`, and `attention-routes.ts`,
with the schemas in `protocol/attention.ts`.

## The frame: what "hardened" can actually mean

"Prompt-injection hardened" is not reachable as a property of prompts. You
cannot write a system prompt clever enough that no crafted input ever steers the
model, and pretending otherwise is how you build a system that fails quietly.
What _is_ reachable is a weaker, honest guarantee: a compromised turn cannot do
**lasting** damage.

So the line is drawn not at the prompt but at the tools that touch the outside
world. A read is cheap to get wrong — the model reasons over bad input and, at
worst, wastes a turn. An **outbound or irreversible** act is not: sending mail,
deleting a file, spending money. Those are gated. When a hijacked turn tries to
`send_message` to `attacker@evil.com`, the operator sees exactly that summary on
a card and does not approve. The blast radius of a bad turn shrinks to "it asked
for something and was told no."

A tool declares itself in this club with one field on its descriptor:
`gated: true`. `tools/send-message.ts` is the worked example — deliberately
inert (its `run` just echoes what it _would_ send), so the gate can be proven
end to end before any real delivery service is wired. When the verbatim lifts
land (mail, Slack), they take this exact shape: `gated: true` and a `run` that
does the outbound act.

## The crux: suspend, don't block

The obvious implementation is a blocking tool call — `run` awaits a human answer
and then proceeds. It is also wrong here, and the reason is worth stating
because it is invisible in the code.

Agent turns run as Flue submissions, and Flue has constants. A claimed
submission gets `timeout_at = now + 1 hour`; if it has not settled by then it is
reclaimed and **retried, up to ten times.** A tool call that parked waiting for
an operator who stepped out for lunch would blow through the timeout, get
reclaimed, and re-run the turn — re-doing whatever it had already done that turn,
ten times over, while burning tokens and holding a lease the entire time. An
overnight approval is simply not expressible as a blocking call.

So the gate inverts it. On an un-approved call the wrapper raises a **pending
approval** plus an **attention item** and **returns immediately** with a message
— "this needs operator approval; stop here." The turn ends cleanly, the
submission settles, no lease is held, nothing waits. The job moves to a waiting
state on the board and the process forgets about it until the operator acts. A
gate that suspends costs nothing while it waits; a gate that blocked would cost
a retry storm.

## Resume is a new turn, not a resumed call

When the operator approves, `attention-routes.ts` does two things: it flips the
approval via `AttentionStore.answer`, and it **dispatches a brand-new turn** into
the same session — "your request to run `send_message` was approved — proceed
with the same call." (Delivery goes through `deliverToSession`, the same
inject-don't-import seam the jobs coordinator uses; see `architecture.md`.)

This is the shape that matters. The session history is intact, so the model
re-renders, sees _its own earlier attempt_ sitting in the transcript, and
re-issues the call. This time the wrapper finds a matching approval and calls
through. Nothing about the original tool invocation was frozen and thawed — it
is a **resumed job, delivered as a new turn**, not a resumed tool call. That is
the only shape that survives a wait measured in hours, because there is no live
call-stack to keep alive across it.

A **denial** is the same mechanism with a reason attached: the delivered message
carries the operator's words ("recipient looks wrong"), and the model is told to
adapt or stop rather than retry. The reason is a first-class column on the
approval so it can travel to the model.

## One-shot: an approval is not "approve forever"

An approval is bound to a single call: the triple `(session, tool,
argumentsHash)`, where `argumentsHash` is a stable SHA-256 of the tool's
arguments (`hashArguments`). It is **consumed the instant it is used.**
`consumeApproval` finds the approved row for that exact triple and, in the same
breath, moves it past `approved` to an internal `consumed` state — so a second,
identical call finds nothing and hits the gate again.

This is deliberate and load-bearing. Approving "send _this_ mail to _this_
person" must not become a standing licence to send any mail. A re-issued call
needs a fresh approval. And because the binding includes the arguments hash, a
call with **any different argument is a different call** with its own gate:
approving `body: "hi"` does nothing for `body: "different"`. The tests in
`tests/tools/confirm-gate.test.ts` pin both edges — approved-once-then-gated-
again, and distinct-argument-gated-separately.

One wrinkle worth knowing: `consumed` is an internal state, not part of the wire
enum. `ApprovalState` (in `protocol/attention.ts`) is `pending | approved |
denied | cancelled`; `rowToApproval` presents a `consumed` row back to the API
as `approved`, since to an observer it _was_ approved. The extra state exists
only so matching can tell "approved and unused" from "approved and spent."

There is also a duplicate-suppression check: `pendingFor` lets the wrapper
notice an approval is already pending for this exact call and restate "still
awaiting" rather than raising a second identical card.

## Where the gate intercepts

The gate is not code inside any tool. It is a wrapping `AttachTool` —
`gatingAttach` in `tools/confirm-gate.ts` — that the tool registry calls when a
tool is mounted (the seam M6 built). For a non-gated descriptor it mounts the
tool untouched. For a gated one it mounts `wrapGated` instead.

The wrapping is surgical, and the surgery is the point. `wrapGated` reuses the
**mounted Flue tool object** and swaps _only_ its `run` — same name, same
description, same already-compiled input schema. It does **not** call
`defineTool` again, so Flue never re-validates the schema, and the model sees a
tool identical to the one it was offered. Because the wrap sits at the mount
point over the tool object rather than inside any implementation, **local, MCP,
and plugin tools all gate identically**, and the tool itself knows nothing about
gating. Gating is a property of the mount, not of the tool.

The wrapped `run`, in order: hash the arguments; if an approval can be consumed,
call the original `run`; else if one is already pending, restate that it is
waiting; else raise the gate and return the "needs approval" message. The tenant,
agent, session and job all come from the `ToolContext` the render bound in —
the same render-time identity binding described in `architecture.md`, since Flue
does not tell a tool who called it.

## Cancellation: a late approval cannot wake a dead job

An approval can outlive the work that raised it. A job whose deadline expires,
that an operator stops, or that crashes goes terminal — but its pending approval
is still sitting on the board. If the operator approved it an hour later, a naive
system would dispatch a turn into a dead job's session.

So when a job goes terminal, `cancelForJob` cancels every pending approval for
that job (and dismisses its open attention items). A late approval then has
nothing to flip and nothing to resume. This is wired through the jobs
coordinator's **terminal-listener seam** (`setTerminalListener`, from `app.ts`),
the same inject-don't-import pattern as the dispatcher — the attention store is
reached, never imported.

And this is precisely why the deadline columns had to exist from the first jobs
migration rather than arriving in a later `ALTER`: M7's confirm-gates depend on a
job being able to _have_ a deadline that expires. `jobs.md` tells that half of
the story; this is the caller it was built for. An approval raised in a plain
chat rather than a job carries a null `jobId` and simply is not subject to this
sweep — there is no job clock to cancel it.

## Attention, the broader surface

An approval is durable operator state; the thing the operator actually _sees_ is
an **attention item**. `AttentionItem` (in `protocol/attention.ts`) is a general
follow-up with a `kind` — today `approval`, with `question` and `failure` marked
out for later — a title, a detail, and a pointer back to its approval. `raise`
writes the approval and its attention item in one transaction; `answer` resolves
the item as it flips the approval; `cancelForJob` dismisses it. The board is one
tenant-scoped query: `AttentionStore.open(tenantId)`, served at
`GET /api/attention`, ordered newest-first.

Everything is tenant-scoped, and the attention store rides the standard tenant-
isolation test suite (`defineTenantIsolationTests` in the store's tests) — one
tenant can neither read, answer, nor list another's approvals. `answer` refuses
an approval that belongs to another tenant or has already been answered.

## Proven live, end to end

This was verified as a real flow, not just in unit tests. A live turn tried
`send_message` and **settled without sending** — the gate suspended it. The
operator approved. A **new turn** resumed the session and this time the message
went out. The audit then showed **two settled submissions** (the suspended
attempt and the resuming turn) and the approval marked consumed — which is the
whole thesis made observable: suspend-and-resume, not block. The same shape works
with no job at all: a gated tool in a plain chat ends the turn asking, and the
operator's answer dispatches a new turn back into that conversation.

## Where to go next

`jobs.md` for the deadline machinery this leans on, and `audit-and-cost.md` for
how the two-submission record above is read back.
