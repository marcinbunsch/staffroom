# Widgets & dashboards — plan of attack

> **Built.** This shipped; the plan is kept as the design record. Where it
> disagrees with the code, the code won.

Agents produce durable, self-updating **outputs** (a Markdown block or a
Vega-Lite chart). Each output is a **widget** the agent owns and updates in
place. A tenant assembles **dashboards** — grids that reference widgets from any
agent — to read the status of everything in one place.

The goal is visualization: agents already produce a lot of text, which is good
source data but hard to grok. Widgets are the small, curated, always-current
readouts an operator actually watches; a routine keeps them fresh.

Started 2026-09-12 on branch `thin-wolverine`.

---

## What we are building, in one paragraph

An agent emits a **widget** by calling one tool with a stable `key`, a `type`
(`markdown` | `vega-lite`), a `title`, and the rendered `content`. The same key
on the next run **updates in place** — a widget is one row, overwritten, with no
version history: it is a snapshot of what the agent knew on its last run, and the
agent's own memory is the history behind it. Every widget is owned by exactly one
agent; the agent's **board** is the auto-view of all its widgets. A **dashboard**
is a user-curated grid that stores only _layout + references_ to live widgets, so
when an agent updates a widget every dashboard showing it reflects the latest on
next open. The charting primitives (`VegaChart`, `Markdown`) and the
"row + tool + migration" pattern already exist; the only net-new piece is a
draggable grid.

## Decisions (from the design conversation, 2026-09-12)

1. **Stable string key, agent-addressed.** The agent names its own widgets
   (`revenue-summary`). `UNIQUE(tenant_id, agent_id, key)`; a write is an
   **upsert** so the row `id` is stable across runs. A `list_widgets` tool lets
   the agent see its own keys so it reuses them rather than spawning duplicates.
2. **Dashboards reference live widgets, never copy.** A dashboard item stores
   `(widget_id, x, y, w, h)`. Content is always the widget's latest. No
   snapshotting in v1.
3. **No widget history.** Each update overwrites the single row. The agent keeps
   its own history (memory) to _produce_ the widget; the widget is the snapshot.
   One source of truth: the latest agent run.
4. **Update on page open / poll, not live push.** A board/dashboard fetches the
   latest widgets when opened. The SSE "doorbell" (`operator-events`) is _not_
   wired in v1 — adding a `widget.changed` event later is ~a dozen lines if
   polling feels stale. This keeps v1 small.
5. **Two types to start:** `markdown` and `vega-lite`. The `type` column is open
   for `number`/`table`/`image` later without a schema change.
6. **Names.** The primitive is a **widget**; the per-agent page is its **board**;
   the top-level curated views are **dashboards**. ("Artifact" is taken — it means
   a `files` row.)

## Ownership & tenancy

A widget is **private to its owning tenant**, like memory and jobs (not the
"mine + org-shared" read that files use). Store methods take `tenantId` first and
scope every query to it. A dashboard is likewise tenant-scoped. There is no
sharing surface in v1.

The widget tool is a **built-in**, attached in `staff-agent.ts` beside the file
tools — every agent can produce widgets, no grant needed. Unlike file promotion,
a widget carries no leak-path concern: it never crosses tenant lines.

---

## Build order, file by file

### Phase 1 — the widget primitive (no UI)

Agents can produce and update widgets; testable over the API / CLI.

1. **`packages/protocol/src/widgets.ts`** — the wire types.
   - `WidgetType = z.enum(["markdown", "vega-lite"])`
   - `Widget = { id, tenantId, agentId, key, type, title, content, updatedAt, createdAt }`
   - `WidgetInput = { key, type, title, content }` (what the tool/route accept)
   - Export a `WIDGET_CHANGED = "widget.changed"` constant now, unused until a
     later phase wires the operator event (keeps the one place types live honest).
   - Add `export * from "./widgets.ts"` to `packages/protocol/src/index.ts`.

2. **`packages/server/src/coordinator/schema.ts`** — add `WidgetTable`
   (snake_case: `id, tenant_id, agent_id, key, type, title, content, created_at,
updated_at`) and register it on the `Schema` interface as `widgets`.

3. **`packages/server/src/coordinator/migrations.ts`** — append
   `"033-widgets"` (next in sequence). Create the `widgets` table; add
   `widgets_owner` index on `(tenant_id, agent_id)` (the board read) and a
   **unique** index `widgets_key` on `(tenant_id, agent_id, key)` (the upsert
   target). Migrations are append-only — do not touch existing ones.

4. **`packages/server/src/coordinator/widgets.ts`** — `WidgetsStore`, modelled on
   `FilesStore` but simpler (no bytes, no search, no sharing):
   - `put(tenantId, agentId, input): Widget` — upsert on `(tenant_id, agent_id,
key)`; insert with a fresh `randomUUID` or update the existing row's
     `type/title/content/updated_at`, preserving `id` and `created_at`.
   - `listForAgent(tenantId, agentId): Widget[]` — the board read, `updated_at desc`.
   - `list(tenantId): Widget[]` — every widget the tenant owns (for the dashboard
     picker), ordered by `agent_id` then `updated_at`.
   - `get(tenantId, id): Widget | undefined`
   - `remove(tenantId, id): boolean`
   - `rowToWidget` at the boundary; module-level `getWidgetsStore()` singleton
     like the other stores. **No** event publish in v1 (decision 4).

5. **`packages/server/src/tools/widget-tools.ts`** — `attachWidgetTools(context:
{ tenantId, agent })`, following `file-tools.ts`:
   - `useInstruction(...)` — explain what a widget is, that it renders on the
     agent's board and on dashboards, that reusing a `key` updates in place, and
     that a `vega-lite` widget's content is a Vega-Lite JSON spec (reuse the
     spirit of `CHART_GUIDANCE`: inline `data.values`, omit width/height/colours).
   - `set_widget({ key, type, title, content })` — validate `type`; for
     `vega-lite`, `JSON.parse` the content and reject a malformed spec with a
     helpful message rather than storing garbage. Returns a confirmation naming
     the key and whether it was created or updated.
   - `list_widgets()` — the agent's own keys + titles, so it reuses keys.
   - (Deliberately no `delete_widget` for the agent in v1; operator deletes via UI.)

6. **Wire the tool in `packages/server/src/agents/staff-agent.ts`** — add
   `attachWidgetTools({ tenantId: identity.tenantId, agent: identity.agentId })`
   beside `attachFileTools`. Built-in, no grant.

7. **`packages/server/src/routes/widget-routes.ts`** — `widgetRoutes` (Hono,
   relative paths, `zValidator`, chained for RPC), mounted at `/api/widgets` in
   `create-app.ts`, type re-exported from `routes/index.ts`:
   - `GET /` — all the tenant's widgets (dashboard picker).
   - `GET /?agent=<id>` — one agent's widgets (board). (One handler, optional query.)
   - `GET /:id` — one widget.
   - `DELETE /:id` — operator removes a widget.
   - (Writes come from the tool, not the API, in v1 — mirrors how artifacts are
     written by tools; the API is read + delete.)

8. **`packages/client/src/domains/widgets.ts`** — `widgetsDomain(ctx)` on the
   typed `hc<WidgetRoutes>` client (copy `files.ts`'s shape): `list()`,
   `listForAgent(agent)`, `get(id)`, `remove(id)`. Register in
   `packages/client/src/index.ts`.

**Check Phase 1:** store tests (`widgets.test.ts`) — upsert keeps `id`, changes
content; `listForAgent` scopes to owner; tenancy isolation. A tool test that a
`set_widget` with a bad Vega-Lite spec is rejected. Then, by hand: give an agent
a routine instruction to maintain a widget, run it, `GET /api/widgets?agent=…`.

### Phase 2 — the agent board (render)

9. **`packages/ui/src/components/Widget.tsx`** — render one widget by `type`:
   `markdown` → the existing `Markdown` component; `vega-lite` → `VegaChart`
   fed the parsed spec, wrapped in `ChartFrame`. A card chrome with the title and
   `updated_at`. A malformed spec falls back to showing the raw content (matching
   how a bad fence renders today).

10. **`packages/ui/src/stores/WidgetsStore.ts`** — MobX store like
    `RoutinesStore`: `load(agent?)`, `remove(id)`. Register in
    `stores/RootStore.ts` / `context`.

11. **The board** — surface an agent's widgets. Simplest: a **tab/section on the
    agent view** (`/a/:agentId`) or a dedicated `/a/:agentId/board` route in
    `Shell.tsx`. A plain responsive CSS grid of `Widget` cards (no drag yet).
    Loaded on open (decision 4).

**Check Phase 2:** open an agent that has produced widgets; see its board render
markdown + a chart, current as of the last run. This is the first end-to-end
value.

### Phase 3 — dashboards (the ambitious part)

12. **Protocol + schema + migration** — `Dashboard = { id, tenantId, name,
sortOrder }` and `DashboardItem = { dashboardId, widgetId, x, y, w, h }`.
    Two tables (`dashboards`, `dashboard_items`), migration `"034-dashboards"`.

13. **`DashboardsStore` + routes + client domain** — CRUD for dashboards and
    their items (create/rename/delete a dashboard; add/remove/move a widget).
    Deleting a widget must cascade-clean `dashboard_items` (or the item read
    left-joins and drops orphans).

14. **The grid UI** — a top-level `/dashboards` screen + rail nav entry. This is
    the one net-new dependency: add `react-grid-layout` (or `dnd-kit`) for the
    draggable/resizable grid. A dashboard is a set of placed `Widget` cards; a
    picker lists all widgets across agents (from `GET /api/widgets`) to add. Save
    layout on change.

**Check Phase 3:** create a dashboard, drop widgets from two different agents,
rearrange, reload — layout persists, content is each agent's latest.

## Where each thing will live (mirrors the files primer's table)

| Concern                          | Where                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| Widget wire types + event name   | `packages/protocol/src/widgets.ts`                                                  |
| The widget store (upsert, reads) | `packages/server/src/coordinator/widgets.ts`                                        |
| The agent's tools                | `packages/server/src/tools/widget-tools.ts`                                         |
| The read/delete HTTP API         | `packages/server/src/routes/widget-routes.ts`                                       |
| Rendering one widget             | `packages/ui/src/components/Widget.tsx`                                             |
| Dashboards store/routes/grid     | `coordinator/dashboards.ts`, `routes/dashboard-routes.ts`, `screens/Dashboards.tsx` |

## Deferred / explicitly out of scope for v1

- **Live push** (`widget.changed` on the operator stream). Add if polling feels
  stale — the type constant ships in Phase 1 so the seam is ready.
- **Widget history / time-series from past values.** The agent's memory is the
  history; widgets stay latest-only.
- **Sharing widgets/dashboards across tenants.** Tenant-private throughout v1.
- **More widget types** (`number`, `table`, `image`). The `type` column is open.
- **Search indexing of widget content.** Not indexed in v1.
</content>

</invoke>
