# Tasks & inbox — plan of attack

Two productivity surfaces on top of what already exists. **Tasks** are the
operator's to-do list — work assigned to the operator or to an agent, with
files, jobs and conversations hanging off it. The **inbox** is every chat
across every agent in one list, newest agent reply first, so "which
conversation do I jump into next?" has one answer.

Started 2026-09-24 on branch `add-task-chat-inbox`.

---

## What we are building, in one paragraph

A **task** is a higher-level concept than a job. A job stays what it is — a
primitive: one unit of agent execution with its own session, state machine,
caps and cost. A task is the thing a _person_ tracks: "ship the pricing page",
assigned to me or to `code`, spanning any number of jobs, files and chats. The
back-and-forth on a task happens in **task chats** — ordinary chats with a
`task_id`, any number per task, with any agents — so a job opened from a task
chat reports back into that task chat by the existing
"jobs report to the chat they came from" rule. The **inbox** is the cross-agent
view of chats that makes those replies (and every other chat's) findable.

## Decisions (from the design conversation, 2026-09-24)

1. **Tasks are new; jobs become a primitive.** A task is not a job and does
   not replace the Jobs board — it sits above it. A task spans many jobs
   (`jobs.task_id`); a job belongs to at most one task.
2. **Many chats per task.** A task may have several chats, with several
   agents (and more than one with the same agent). A task chat is a side chat
   with a `task_id` — still "a conversation, not a different agent."
3. **Agents can create tasks** — including tasks assigned to the operator
   ("review this PR"). An agent can also update status and attach files.
4. **Assignee is the operator or one agent.** `assignee_kind` is
   `operator | agent`; `assignee` is the agent id when it is an agent.
5. **The inbox is every chat, sorted, with unread and recent made prominent.**
   Unread chats pin to the top; everything else follows by latest agent reply
   and naturally sinks as it goes quiet. Archiving a chat is closing it.
6. **Inbox first.** It stands alone, needs no new concept, and immediately
   helps with the chats that already exist. Tasks build on it (task chats show
   up in the inbox with their task's title).

---

## Phase 1 — the inbox

### Data

- **Migration `036-chat-preview`**: `chats.last_preview TEXT NULL` — a short
  plain-text excerpt of the agent's last reply, so the list can show "what did
  they say" without loading a transcript.
- `chat-activity.ts` already `touch`es a chat on `agent_end`; it now also
  records the preview, taken from the last assistant message's text parts in
  the event's `messages` (whitespace collapsed, capped at `CHAT_PREVIEW_MAX`).
  A turn that produced no text (tool calls only) leaves the old preview.
- `lastMessageAt` is set only on `agent_end`, so it already means "the agent's
  latest reply" — exactly the inbox's ordering key.

### Store & route

- `ChatStore.inbox(tenantId, { limit, offset })` — open chats across all
  agents that have had at least one reply, ordered by `last_message_at desc`.
  A chat nobody has spoken in yet is noise, not mail, so it is left out.
- `UnreadStore.all(tenantId)` — unread per session for the whole tenant.
- `GET /api/chats/inbox` — the page, each chat decorated with `unread` and
  `active` (like the tab strip), plus the total. Unread chats sort first
  server-side so pinning survives paging.

### UI

- `/inbox` screen (`screens/Inbox.tsx`): one row per chat — avatar, agent
  name, chat title, preview, relative time, unread badge, at-work dot. Unread
  rows are bold under an **Unread** header; the rest under **Earlier**. Row
  click opens `/a/:agent/c/:chatId` (which marks it read). Hover actions:
  mark read, archive (close; not offered on a main chat).
- Rail: **Inbox** under Home, badged with the tenant's total unread.
- Command palette "Go to" gets Inbox; a `g i` style shortcut is optional.
- Live: `InboxStore` reloads on `agent.unread.changed` /
  `agent.activity.changed`, same as the tab strips.

## Phase 2 — tasks

### Data

- **Migration `037-tasks`**:
  - `tasks`: `id INTEGER PK`, `tenant_id`, `title`, `notes`, `status`
    (`open | in_progress | waiting_on_you | done | dropped`), `assignee_kind`
    (`operator | agent`), `assignee` (agent id, nullable), `created_by`
    (`operator` or an agent id), `created_at`, `updated_at`, `completed_at`.
  - `task_files`: `(task_id, file_id)` — files explicitly attached to a task.
    Files produced by a task's jobs appear automatically via `files.job_id`.
  - `jobs.task_id INTEGER NULL` — the task a job serves. A child job inherits
    its parent's.
  - `chats.task_id INTEGER NULL` — the task a chat is about.
- Protocol `tasks.ts`: `TaskStatus`, `Task`, `TaskInput`, `TaskDetail`
  (task + chats + jobs + files).

### Behaviour

- **Opening a task chat**: `ChatStore.openSide(..., { taskId })`; the title
  defaults to the task's title.
- **Assigning a task to an agent** opens a task chat with that agent and
  dispatches a short digest into it ("You've been assigned task #12: …"). The
  agent decides whether that needs jobs; any `job_create` from that chat gets
  `task_id` from the chat and reports back into it.
- **Task context in a task chat**: when a turn renders in a session whose chat
  has a `task_id`, the prompt gains a compact task digest (title, status,
  notes, attached files, jobs and their states) so "this" needs no pasting.
- **Referencing a task from any chat**: phase 3 (`#12` in the composer with
  autocomplete, resolved to the digest by a `task_get` tool call).

### Agent tools (`tools/task-tools.ts`)

`task_create`, `task_list`, `task_get`, `task_update` (status / notes /
assignee), `task_attach_file`. Inside a task chat, the task id defaults to the
chat's task.

### Routes & UI

- `task-routes.ts`: list (filter by assignee/status), detail, create, update,
  attach/detach file, open a chat on a task.
- `/tasks` screen: **Mine** (assigned to the operator), **With the staff**
  (assigned to agents), **Done** (paged). Inline create.
- `/tasks/:id`: title/notes/status/assignee editable; **Conversations** (task
  chats, "Ask an agent…" to open another); **Jobs** (linked, with state);
  **Files** (attached + produced).
- Chat screen: a task banner above the transcript when the chat has a task.
- Inbox rows for task chats show the task title as context.

## Phase 3 — later

- `#task` references in any chat's composer.
- Task due dates, and a Home section for "your tasks due soon".
- A task-scoped attention filter (attention items raised in a task's chats or
  jobs shown on the task page).
