# Skills — a primer

An agent skill is a named, reusable procedure: a short description of _when_ to
use it and a longer body of _how_. An agent can write itself one mid-turn
("here is how I triage an incident"), an operator can hand one down, and an
admin can publish a house-wide one. It is persistent instruction — the same
shape, and the same risk, as a memory note that never expires.

Everything here lives in `coordinator/skills.ts` (the store), `tools/skills.ts`
(the mount and the agent-facing tool), `skill-routes.ts` (the HTTP surface), and
`protocol/src/skills.ts` (the schema). Read `memory.md` alongside it — skills
are memory's more deliberate sibling — and `confirm-gates.md` for why one field
is admin-only.

## Skills are rows, not discovery

Flue implements the Agent Skills spec, and it would be tempting to lean on that.
But Flue's _discovery_ reads `.agents/skills/` through a session's **sandbox**,
so it only works for agents that _have_ a sandbox — a minority here. Most staff
never touch a filesystem.

So skills are rows in `staffroom.db` instead, mounted at render time with
`useSkill()` as inline definitions. This buys three things at once: it works for
**every** agent regardless of sandbox; it rides the **same tenant seam** as
everything else (a skill row is scoped by `tenant_id` and `agent` like memory,
files and jobs); and it keeps durable agent state in **one place** — a store the
operator can read and edit — rather than scattered across sandbox filesystems the
operator can't see.

**Progressive disclosure survives the move.** The whole point of the spec is
that a skill costs almost nothing until it fires: only the name and description
enter the prompt, and the full instructions arrive later as the
`activate_skill` tool result. Inline `useSkill()` definitions preserve exactly
that — so the per-render cost of a mounted skill is _one indexed row read_, not
a body's worth of tokens.

## The render set

`SkillsStore.forRender(tenantId, agent)` returns the skills to mount for one
agent's turn: its own enabled skills, plus the enabled skills of the **org
directory** — an admin-curated set where the house style lives. `attachSkills`
in `tools/skills.ts` walks that list and calls `mountSkill` per row.

Scope mirrors memory: an agent writes only into its **own** set and reads its
own plus the org directory. Private by default, so two agents can't collide and
one tenant's skills never leak into another's render (there is a tenant-isolation
test, and `forRender("bob", …)` returns nothing an agent under `alice` wrote).

## The three load-bearing rules

Each of these is pinned by a test, because each guards against a failure mode
that is quiet until it isn't.

### 1. Validate on write, mirroring Flue exactly

The schema in `protocol/src/skills.ts` (`SkillName`, `SkillInput`) enforces
Flue's own `normalizeSkillDefinition` rules: a name of 1..64 chars matching
`^[a-z0-9]+(?:-[a-z0-9]+)*$`, a description of 1..1024, non-empty instructions.

Why be this strict on write? Because a row Flue would reject at mount throws
_inside_ `useSkill()` — and that failure isn't scoped to the one turn that
happens to use the skill. It fails **every** turn for that agent, because the
mount runs at render, before the agent does anything. A single bad row bricks the
member.

So the defence is two-layered. The schema **rejects the write** (both the
`write_skill` tool and the HTTP route `safeParse` before storing), and belt-and-
braces, `mountSkill` wraps `useSkill()` in a try/catch and **skips a bad row with
a `console.warn`** rather than letting it take down the render — the same stance
Flue itself takes for a malformed discovered skill. `skill-validation.test.ts`
pins our schema to Flue's exact rules (copied from
`packages/runtime/src/skill-definition.ts`) so the two cannot silently drift.

### 2. Resolve name collisions before mounting

An agent skill and an org skill may legitimately share a name — an agent
specialising the house style with its own version of `report`. That is allowed
at write time (the uniqueness checks are per-scope). But `useSkill()` throws if
handed two skills of one name, so the collision must be resolved _before_ the
mount, not left to Flue.

`forRender` does it: it builds a `Map` keyed by name, fills it with the org
directory first, then overlays the agent's own — so **the agent shadows the
org**, deduped by name, and the render never sees two of a kind. The test proves
`report` appears once, with the agent's instructions, not the org's.

### 3. `allowedTools` is admin-only

The spec lets a skill name "pre-approved tools" that skip confirmation. That is
exactly the field an agent must not be allowed to set for itself — an agent-
authored `allowedTools` would route straight _around_ the confirm-gates (see
`confirm-gates.md`). So it is locked down at every layer:

- **Absent from `write_skill`'s input** entirely — an agent can't even name it.
- **Forced null on any non-admin write** — `writeAgentSkill` always inserts
  `allowedTools: null`; only `writeOrgSkill` (admin) accepts a value.
- **Honoured on mount only when `source === "admin"`** — `mountSkill` passes it
  through solely for admin rows, dropping it otherwise even if a value somehow
  sat in the row.

The `source` column (`agent` | `operator` | `admin`) is what carries this
distinction, and it is why provenance is recorded rather than inferred.

## Trust: why no approval gate

A skill is persistent instruction, so a _wrong_ skill is the same class of risk
as a wrong memory note — an agent quietly following bad guidance on future
turns. We answer it the same way memory does, and deliberately **not** with an
operator approval step:

- **Active immediately, and visible.** A written skill takes effect next turn and
  shows up on the operator's screen via the Skills API (`skill-routes.ts`:
  `GET/POST/PATCH/DELETE /api/staff/:agent/skills`, plus `/api/org/skills`). The
  operator can read, edit the instructions in place, or delete.
- **An `enabled` flag, not deletion, for switching one off.** A bad skill can be
  disabled _without losing the text_, so it can be fixed and re-enabled rather
  than rewritten from scratch. Disabled skills drop out of `forRender`.
- **A hard cap on enabled skills** (`MAX_ENABLED_SKILLS = 24`). Every mounted
  skill costs a catalog line in the prompt each turn, so the count is bounded —
  the write _fails_ (`SkillsFullError`) past the cap rather than silently
  bloating the render, and `update(...{enabled:true})` re-checks capacity too.
  Disable one to make room.

The road not taken is operator approval on every write. It was rejected on
purpose: gating each skill on the operator makes the operator the bottleneck on
the very feature meant to _save_ them time. Visibility-after-the-fact, plus an
off switch that keeps the text, is the cheaper guarantee that still lets a bad
skill be caught and killed.

## Where the pieces live

| Concern                        | Location                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- |
| Schema, name rules, the cap    | `protocol/src/skills.ts`                                                   |
| The store, scopes, collisions  | `coordinator/skills.ts` (`SkillsStore`)                                    |
| Mount + the `write_skill` tool | `tools/skills.ts` (`attachSkills`, `mountSkill`)                           |
| Operator/admin HTTP            | `skill-routes.ts`                                                          |
| The store/mount tests          | `tests/coordinator/skills.test.ts`, `tests/tools/skill-validation.test.ts` |

## Verified live

Two paths were exercised against a running process: an operator added a skill
through `POST /api/staff/:agent/skills`, and an agent wrote itself one through
`write_skill` in a real turn. Both landed as rows and both surfaced with the
correct provenance — `source: operator` for the first, `source: agent` for the
second — which is the distinction rule 3 rests on.

## Scoped out of v1

- **`SkillDefinition.files`** — the spec lets a skill bundle attachments. We
  don't, on purpose: an attachment's home is the files store, referenced from the
  instructions. One file concept (see `files.md`), not a second one hidden inside
  skills.
- **`SKILL.md` import/export** — reading and writing the on-disk spec format.
  The rows are the source of truth for now; a bridge to the file format can come
  later without changing anything above.

## Where to go next

`memory.md`, for the tier system this deliberately echoes, and `confirm-gates.md`
for what rule 3 is protecting.
