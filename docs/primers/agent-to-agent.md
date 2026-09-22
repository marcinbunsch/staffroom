# Agent-to-agent — a primer

One agent asking another a question, and the one idea the whole area turns on: a
question is **a blocking tool call, not a job.** Lives in `tools/ask-agent.ts`,
the `setAskAgentDeliver` wiring in `app.ts`, the thread branch of
`agents/staff-agent.ts`, and the `__a2-` session-key suffix in
`protocol/identity.ts`.

## A question is a tool call

`pm` needs to know whether a PR has merged. `code` knows; `pm` does not. So `pm`
calls `ask_agent(to: "code", question: "has the PR merged?")`. The call
dispatches that question into the `pm`↔`code` thread — a session where `code`
renders with its usual prompt, memory and tools — waits for that turn to settle,
and returns `code`'s answer as the tool's **return value**. `pm` never left its
own turn; it made a tool call, got a string back, and carried on. To the operator
it is one reply: "I asked code, it says the PR merged, build 4471."

The alternative was to make every question a job. It is the wrong shape, and
saying why is the point of this primer, because the reasoning is invisible in the
code. A **job** is multi-step, handed between agents, outlives the conversation
that opened it, and earns its own session, timeline, caps and cost record for
carrying that weight (see `jobs.md`). "Has the PR moved?" carries none of it. A
job per question would be noise on the board — a piece of ceremony around a fact
lookup that resolves in seconds.

## What blocking avoids

Because the asker never leaves its turn, a whole category of machinery simply
never has to exist:

- **No return address.** We never suspended `pm`'s turn, so there is nothing to
  route an answer _back_ to — the answer arrives where the call was made, on the
  call stack.
- **No relay at settlement.** Nobody has to notice `code` finished and forward
  its words to `pm`. `read()` resolving _is_ the forwarding.
- **No dependence on the answerer remembering to reply.** The reply is the return
  value of a function the asker is awaiting; `code` cannot "forget" to return.
- **No queue.** Awaiting is the backpressure. `pm` is parked until the answer
  comes; there is no inbox to drain, no ordering to maintain, no delivery to
  retry. Ordering is the call stack.
- **One turn for the operator.** The whole exchange collapses into a single
  reply rather than a conversation the operator has to reassemble from two
  agents' timelines.

Contrast the confirm-gate (`confirm-gates.md`), which needs every one of those
because it _does_ leave the turn: it raises a pending record, ends the turn, and
resumes later as a brand-new turn. That machinery is the price of waiting on a
human. A question to an agent doesn't pay it.

## The blocking primitive is Flue's own

The tool does not invent blocking; it borrows Flue's durable submission
primitive. In `app.ts`, `setAskAgentDeliver` is:

```ts
const handle = init(StaffAgent, { id: threadSession })
const receipt = await handle.dispatch({ message: { kind: "user", body: message } })
const reply = await handle.read(receipt)
return { text: reply.text }
```

`init(StaffAgent, { id: threadKey })` gives a handle onto the thread session;
`dispatch()` submits the question and `read(receipt)` resolves when _that_
submission settles, durably, through Flue's own store. The asker's turn is
**parked** on that `await` the whole time. This is wired through the same
inject-don't-import seam as the jobs dispatcher and the confirm-gate resume: the
tool module holds an injected `AskAgentDeliver` (`setAskAgentDeliver`), and
`app.ts` — the one module that imports both the tool and the agent — supplies the
implementation, so `ask-agent.ts` needs no agent import.

## The timeout is the question/job boundary

`ask_agent` wraps that await in a 60-second timeout (`TIMEOUT_MS`,
`withTimeout`). The number is not a nervous guess — it is a **line drawn between
two kinds of work.** Under 60s: a question, answerable from what an agent already
knows plus a quick tool call. Over it: real work that belongs in a job.

Sixty seconds is well inside Flue's one-hour submission timeout, and _that_ is
exactly what makes blocking safe here — and unsafe for a human confirm-gate. The
two situations look identical (a tool call that waits for someone else to
answer) and are not. A human approval can wait overnight, blow through Flue's
one-hour timeout, and be reclaimed and retried ten times; it **must** suspend the
turn rather than block it (that is the whole thesis of `confirm-gates.md`). An
agent answers in seconds, comfortably inside the window, so it **can** block. The
timeout is what keeps an agent question on the safe side of that boundary.

When the timeout fires, the tool does not throw a stack trace at the model. It
returns a **job-shaped error**: "@code did not answer within 60s. If this needs
real work rather than a quick answer, open a job instead (job_create)." The
message _teaches_ the model the boundary at the moment it matters, rather than
lecturing it in a system prompt it will half-read. A non-timeout failure (no such
staff member, deliver misconfigured) returns its own plain sentence the same way.

## A thread is a session key

The thread `pm` and `code` talk in is nothing but a session key with a new
suffix: `tenant:code__a2-pm`. `code` is the `agentId` — it **renders and
answers**; `pm` is the `counterpart` — it is who is asking. `parseSessionKey`
learns the `__a2-<counterpart>` suffix alongside the existing `__job-<id>` one
(`A2A_SUFFIX` in `identity.ts`), and `composeSessionKey` builds it from
`{ tenantId, agentId, counterpart }`. The two suffixes are mutually exclusive: a
session is a job session or a thread session, never both.

`ask_agent` composes the key with `to` as the renderer and the asking agent as
the counterpart, so there is **one thread per pair, reused across every
question.** History accumulates in it — sometimes that is useful continuity
("what did we decide about the migration?"), sometimes it is contamination (an
old question colouring a new answer). We keep the single thread anyway: a fresh
session per exchange would leave Flue holding thousands of tiny throwaway
conversations, which is a worse problem than a little stale context.

The tenant rides in the thread key exactly like every other session key — it is
the first segment, ahead of the first `:`. So a thread resumed after a restart,
claimed cold from Flue's poll loop, resolves its owner from the string alone with
nothing threaded through ambient context. This is the load-bearing tenancy claim
(`tenancy.md`), and threads get it for free by being ordinary session keys.

## No request record

There is deliberately **no `a2a_questions` table.** Blocking makes the record
implicit: a _pending_ question is a promise being awaited, an _answered_ one is a
return value, a _failed_ one is a thrown-and-caught tool error, and _ordering_ is
the call stack. The two records that matter already exist — the audit spine holds
the tool call and both turns (`audit-and-cost.md`), and the thread session's own
transcript in `flue.db` holds the full exchange. A third copy would be a table to
keep in sync for no information the first two lack.

## Loop protection is deferred

Nothing today stops `pm` asking `code` a question whose answer makes `code` ask
`pm`, and so on. This is a deliberate deferral, matching the prototype's own
design: blocking already **bounds** any ping-pong — it is a call stack under the
60s timeout, and every hop of it lands in the audit, so a loop is both
self-limiting and visible. The durable fix is the shared causation chain — the
same mechanism the event bus uses to cap cascades (`events-and-schedules.md`) —
carried through the dispatch and refused on re-entry. It lands when something
actually loops, not before.

## What is not built yet

Threads are **read-only, and not tabs.** The operator cannot type into a thread;
it is a transcript to read, not a place to speak. That is on purpose — keeping
the operator out of the thread keeps "whose voice is this?" from ever being a
question. But the UI for reading threads is **not built yet** (M13). That is
fine, because step one — the blocking call itself — is useful entirely on its
own: the answer comes back in the asker's turn whether or not anyone can yet open
the thread to read the exchange.

## Proven live, end to end

This was verified as a real flow. `pm`, told in its own prompt that it does not
know deploy status, was asked for it — and answered "GREEN, build 4471", a fact
only `code` held. The audit showed the whole shape: `pm`'s turn, the `ask_agent`
tool call, `code` answering inside the `code__a2-pm` thread session, then `pm`
resuming with the answer in hand. `flue.db` confirmed the thread standing as its
own durable conversation. The question crossed from one agent to another and came
back as a return value, and `pm` never left its turn.

## Deferred: `agent_message` (fire-and-forget)

The prototype also had `agent_message` — a one-way handoff into another agent's
main chat, delivered without waiting for a reply. v2 does **not** ship it. The
bet is that `ask_agent` (blocking, returns the answer) plus `job_handoff` (hand
over a whole unit of work) cover the real needs, and a third "notify and move on"
tool is a decision the model would have to make on every message for little gain.

Revisit only if `ask_agent` turns out to be too noisy _because_ it forces a
response — i.e. an agent wants to tell a peer something without dragging a reply
turn out of them. If that pressure shows up, `agent_message` is the release
valve; until it does, it stays out.

## Where to go next

`confirm-gates.md` for the contrasting case — a wait that _must_ suspend rather
than block — and `jobs.md` for the heavier shape a question deliberately is not.
