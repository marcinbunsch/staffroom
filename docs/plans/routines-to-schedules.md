# Routines → Schedules (with one-off runs)

> **Built.** This shipped; the plan is kept as the design record. Where it
> disagrees with the code, the code won.

## Context

Today the top-level entity is a **Routine** — one row holding _when_ (a `Schedule`
union: `cron | interval`) and _what_ (agent + instruction). Both variants are
**recurring**; there is no way to run something **once**. An agent asked to "run
this in three hours" has no clean primitive — the only workaround is create-a-routine-
then-delete-it, which we explicitly want to avoid.

We're reframing the concept: **Schedule** becomes the top-level entity. A schedule
either **runs as a routine** (recurring — cron/interval) or **runs once** (a one-off
at a specific time). When a one-off fires it is **marked completed and kept** as a
record — no agent cleanup, "achieved and over". This is a full rename (`Routine` →
`Schedule` across DB, API, tools, UI) plus a new `once` timing variant and a
completion lifecycle.

The design is documented in `docs/primers/events-and-schedules.md` — a schedule is one
row from which a **timer** and a **subscription** derive; the timer publishes
`schedule.fired`, and the event bus matches the derived subscription and opens a job.
The new variant and rename must preserve that "one row, no free-standing producers"
invariant.

## Locked decisions

- **Full rename**: `Routine` entity → `Schedule` everywhere (table, `/api/schedules`,
  agent tools, UI routes/screens). "Routine" survives only as the UI label for the
  recurring mode.
- **One-off lifecycle**: fires once → distinct completed status, row kept (like a
  finished to-do), drops out of the derived subscriptions so it never fires again.

## Naming map

Because the entity takes the name `Schedule`, the current inner union (`cron |
interval`) is renamed to free it up:

| Now                                                            | After                                                            |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| entity `Routine`                                               | `Schedule`                                                       |
| union `Schedule` (the _when_)                                  | `Timing`                                                         |
| field `schedule: Schedule`                                     | `timing: Timing`                                                 |
| `routineSource(id)` → `routine:<id>`                           | `scheduleSource(id)` → `schedule:<id>`                           |
| payload `routineId`                                            | `scheduleId`                                                     |
| operator event `routine.changed`                               | `schedule.changed`                                               |
| tools `routine_set/list/remove`                                | `schedule_set/list/remove`                                       |
| `/api/routines`, `RoutineRoutes`                               | `/api/schedules`, `ScheduleRoutes`                               |
| UI `/routines`, `Routines/NewRoutine/Routine`, `RoutinesStore` | `/schedules`, `Schedules/NewSchedule/Schedule`, `SchedulesStore` |

`SCHEDULE_FIRED = "schedule.fired"` is **unchanged** (already named for schedules).

## Changes by layer

### 1. Protocol — `packages/protocol/src/routines.ts` → `schedules.ts`

- Rename union `Schedule` → `Timing` and add a third variant:
  `z.object({ kind: z.literal("once"), at: z.string().datetime() })`.
- Rename `Routine`/`RoutineInput`/`RoutineUpdate` → `Schedule`/`ScheduleInput`/
  `ScheduleUpdate`; rename field `schedule` → `timing`.
- Add `completedAt: z.string().nullable()` to `Schedule` (mirrors `lastFiredAt`).
- Rename `routineSource` → `scheduleSource` (`schedule:<id>`).
- Update `packages/protocol/src/index.ts` export (and rename the file). `events.ts`,
  `jobs.ts`, `operator-events.ts` references updated (see operator event rename below).

### 2. DB — `packages/server/src/coordinator/migrations.ts` (append-only)

Add migration **`035-schedules`** that:

- `ALTER TABLE routines RENAME TO schedules`
- `ALTER TABLE schedules RENAME COLUMN schedule TO timing`
- `ALTER TABLE schedules ADD COLUMN completed_at TEXT` (nullable)
- drop/recreate the tenant index as `schedules_tenant`.

Update `packages/server/src/coordinator/schema.ts`: `RoutineTable` → `ScheduleTable`
(`timing` JSON string, `completed_at TEXT | null`), re-register on `Schema`.

### 3. Store — `packages/server/src/coordinator/routines-store.ts` → `schedules-store.ts`

- Rename class `RoutinesStore` → `SchedulesStore`, `getRoutinesStore` →
  `getSchedulesStore`, method/announce payloads.
- `create` sets `completed_at = null`; row↔domain mapping handles `timing` +
  `completedAt`.
- Add `markCompleted(tenantId, id, at)` (sets `completed_at`; like `markFired`, does
  **not** touch `updatedAt`).
- `subscriptions()` filters `enabled && completedAt == null` (a completed one-off is
  gone from the bus). `subscription()` match/source use `scheduleSource`.
- `#announce` emits the renamed operator event.

### 4. Scheduler — `packages/server/src/coordinator/scheduler.ts`

- `#scheduleAll` skips completed rows (in addition to `enabled`).
- `#schedule`: add a `once` branch — `new Cron(new Date(timing.at), { maxRuns: 1,
catch }, () => this.#fire(schedule))`. If `at` is already in the past at boot,
  croner won't fire, so handle it like a missed run: if `catchUp` fire once now, else
  skip loudly — **either way mark completed** (a past one-off can never fire again).
- `#fire`: publish as today (payload `scheduleId`), then branch — recurring →
  `markFired` (cursor); `once` → `markCompleted`. After a one-off fires it is
  completed, so it naturally drops from `subscriptions()` on the next publish.

### 5. Event bus — `packages/server/src/coordinator/event-bus.ts`

- Payload field read `routineId` → `scheduleId`; `getEventBus()` wires
  `getSchedulesStore().subscriptions()`. No behavioral change to matcher/guards.

### 6. Routes — `packages/server/src/routes/routine-routes.ts` → `schedule-routes.ts`

- Mount at `/api/schedules` in `routes/index.ts`; export `ScheduleRoutes`.
- Validate with `ScheduleInput`; keep `reloadScheduler()` on every mutation. CRUD only
  (no run-now endpoint, consistent with today).

### 7. Agent tools — `packages/server/src/tools/routine-tools.ts` → `schedule-tools.ts`

- Rename tools to `schedule_set` / `schedule_list` / `schedule_remove`; rename
  `attachRoutineTools` (update `agents/staff-agent.ts`).
- `schedule_set` gains one-off inputs: **`at`** (ISO datetime) and **`in_seconds`**
  (relative — supports "run this in three hours"; `at = now + in_seconds`). Exactly one
  of `cron` / `every_seconds` / `at` / `in_seconds` allowed.
- `parseSchedule` → `parseTiming`: validate cron as today; for `once` require a valid,
  future `at`; return `{ kind: "once", at }`. `describeRoutine` → `describeSchedule`
  renders once as "once at <time>" and notes completed state.
- Keep title-addressed create-or-update, scoped to the calling agent; the set-by-title
  lookup matches only **active (non-completed)** schedules, so reusing a title after a
  one-off completes creates a fresh one.
- Update tool descriptions to mention one-off ("run once at a time").

### 8. Client SDK — `packages/client/src/domains/routines.ts` → `schedules.ts`

- Rename to `schedules` domain, `hc<ScheduleRoutes>`, keep `list/create/update/remove`;
  update `client/src/index.ts` and `client/src/types.ts`.

### 9. UI — `packages/ui`

- Rename screens `Routines.tsx`/`NewRoutine.tsx`/`Routine.tsx` →
  `Schedules.tsx`/`NewSchedule.tsx`/`Schedule.tsx`; routes `/routines*` → `/schedules*`
  (update `Shell.tsx`, `Board.tsx`, `AgentSidebar.tsx` links).
- `stores/RoutinesStore.ts` → `SchedulesStore.ts`; update `RootStore.ts`,
  `context.tsx`, operator-stream handler for `schedule.changed`.
- `lib/routine.ts` → `lib/schedule.ts`: `describeSchedule` renders the `once` variant
  ("once at <local time>") alongside cron/interval.
- **New Schedule form**: the timing `<select>` gains an **Once** option grouped under
  the recurring cron/interval options — framed as "Repeat (routine)" vs "Once" — with a
  datetime-local input for `once`.
- **List/detail**: show a **completed/done** badge for finished one-offs (distinct from
  the paused state); add a "done" filter chip. One-off rows show their scheduled time.

### 10. Docs — `docs/primers/`

- Rename `events-and-routines.md` → `events-and-schedules.md`; update prose to the
  schedule/timing vocabulary and add a short section on the `once` variant + completion
  ("fires once, marked completed, kept"). Update cross-references in `README.md`,
  `jobs.md`, `architecture.md`, `agent-to-agent.md`, `files.md`, `search.md`,
  `chats.md`. Leave historical `docs/plans/*` and `docs/research/*` untouched.

### 11. Tests — `packages/server/tests/`

- Rename `coordinator/routines.test.ts` → `schedules.test.ts` and
  `tools/routine-tools.test.ts` → `schedule-tools.test.ts`; update `scheduler.test.ts`,
  `event-bus.test.ts`, `file-bus.test.ts` to the new names.
- New cases: (a) a `once` schedule fires exactly once, then `completedAt` is set and it
  drops from `subscriptions()`; (b) a `once` whose `at` is in the past at boot — skipped
  loudly by default / fired once with `catchUp`, and marked completed either way; (c)
  `schedule_set` with `at` and with `in_seconds` produces a `once` timing; (d)
  mutually-exclusive timing inputs are rejected.

## Verification

- `pnpm -r typecheck` (or per-package) — the rename must leave no dangling
  `Routine`/`routineSource`/`schedule:`-payload references: `grep -rn "Routine\b\|routineSource\|routineId\|/api/routines" packages` should come back clean (only historical `docs/plans|research` may still say "routine").
- `pnpm -r test` — all renamed suites plus the new one-off cases pass.
- Migration: run the server against an existing `staffroom.db` and confirm `035-schedules`
  renames the table/column and adds `completed_at` without data loss (existing routines
  become active recurring schedules).
- End-to-end in the app (`/run` skill): create a recurring schedule and a one-off (via
  the New Schedule form and via `schedule_set` with `in_seconds`), watch the one-off open
  a job when it fires and then show as **completed** in the list; confirm the recurring
  one keeps firing and a paused one shows distinctly from a completed one.
