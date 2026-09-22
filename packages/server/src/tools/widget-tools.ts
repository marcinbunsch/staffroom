import { defineTool, useInstruction, useTool } from "@flue/runtime"
import * as v from "valibot"
import { getWidgetsStore } from "../coordinator/widgets.ts"

/**
 * The widget tools an agent gets. A widget is a durable, self-updating output —
 * a Markdown block or a Vega-Lite chart — that renders on the agent's board and
 * on any dashboard. An agent addresses a widget by a stable `key`: re-using the
 * key updates it in place, so a schedule keeps one widget current rather than
 * spawning a new one each run.
 *
 * Built-in and ungated, like the file tools: every agent can produce widgets,
 * and a widget never crosses tenant lines, so there is no promotion step.
 */
export interface WidgetToolContext {
  tenantId: string
  agent: string
}

export function attachWidgetTools(context: WidgetToolContext): void {
  useInstruction(
    "## Widgets (dashboard outputs)\n\nA widget is a durable, at-a-glance output that renders on your board and on the operator's dashboards — use one for a status readout you keep current across runs, not for one-off prose. Address each widget by a stable `key` (e.g. `revenue-summary`): calling `set_widget` again with the same key **updates it in place**, so on a recurring schedule you refresh the same widget rather than making a new one. Call `list_widgets` first to see the keys you already maintain and reuse them.\n\n- A `markdown` widget's content is Markdown; a `vega-lite` widget's content is a Vega-Lite JSON spec (put the data inline under `data.values`; omit width/height and colours — the app themes and sizes it).\n\nA widget is a snapshot of what you know now; there is no history, so read your memory and the latest data to produce it fresh each time.",
  )
  useTool(makeSetWidget(context))
  useTool(makeListWidgets(context))
}

function makeSetWidget(context: WidgetToolContext) {
  return defineTool({
    name: "set_widget",
    description:
      "Create or update a widget — a durable output that renders on your board and on dashboards. Re-using a `key` updates that widget in place. Use `markdown` for a text readout, `vega-lite` for a chart (content is a Vega-Lite JSON spec).",
    input: v.object({
      key: v.pipe(
        v.string(),
        v.minLength(1),
        v.maxLength(128),
        v.description("A stable identifier for this widget, reused to update it (e.g. 'revenue')"),
      ),
      type: v.pipe(
        v.picklist(["markdown", "vega-lite"]),
        v.description("'markdown' for a text block, 'vega-lite' for a chart"),
      ),
      title: v.pipe(v.string(), v.minLength(1), v.maxLength(200), v.description("A short heading")),
      content: v.pipe(
        v.string(),
        v.minLength(1),
        v.description("Markdown text, or a Vega-Lite JSON spec when type is 'vega-lite'"),
      ),
    }),
    run: async ({ data }) => {
      // Reject a malformed Vega-Lite spec rather than storing garbage that would
      // render as raw source on the board.
      if (data.type === "vega-lite") {
        try {
          JSON.parse(data.content)
        } catch (error) {
          return `The content is not valid JSON, so it is not a Vega-Lite spec: ${message(error)}. Fix the JSON and call set_widget again.`
        }
      }
      const store = getWidgetsStore()
      // Whether this key already exists, only so the reply says "Updated" vs
      // "Created"; `put` upserts either way.
      const existed = store
        .listForAgent(context.tenantId, context.agent)
        .some((widget) => widget.key === data.key)
      const widget = store.put(context.tenantId, context.agent, data)
      return `${existed ? "Updated" : "Created"} widget "${widget.title}" (key ${widget.key}). It renders on your board and any dashboard that references it.`
    },
  })
}

function makeListWidgets(context: WidgetToolContext) {
  return defineTool({
    name: "list_widgets",
    description:
      "List the widgets you maintain, by key and title, so you can reuse a key to update an existing widget rather than creating a duplicate.",
    input: v.object({}),
    run: async () => {
      const widgets = getWidgetsStore().listForAgent(context.tenantId, context.agent)
      if (widgets.length === 0) return "You have no widgets yet."
      return widgets.map((widget) => `- ${widget.key} (${widget.type}): ${widget.title}`).join("\n")
    },
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
