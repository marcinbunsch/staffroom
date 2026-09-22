import { defineTool } from "@flue/runtime"
import type { ToolsetTypeDef } from "@staffroom/plugin-core"
import * as v from "valibot"

/**
 * Example 1 — the simplest TOOLSET KIND: one that just contributes a tool.
 *
 * A plugin does not add loose tools; a tool lives inside a toolset, so it is
 * installed and uninstalled as a unit (like the built-in MCP and sandbox
 * toolsets). This `weather` kind needs no URL and no integration — it reads its
 * key from `process.env` — so `usesUrl`/`usesIntegration` are both left false and
 * the create form asks only for a name.
 *
 * Grant a toolset of this kind as `weather:<name>`. Its `resolve` returns the
 * tool descriptor; the server attaches it (the plugin never calls a render hook).
 */
export const weatherToolset: ToolsetTypeDef = {
  kind: "weather",
  label: "Weather",
  description: "Look up the weather. Set WEATHER_API_KEY in the environment.",
  resolve() {
    const weatherLookup = defineTool({
      name: "weather_lookup",
      description: "Look up the current weather for a city. Read-only.",
      input: v.object({
        city: v.pipe(v.string(), v.description("City name, e.g. 'Kraków'.")),
      }),
      run: async ({ data }) => {
        const apiKey = process.env.WEATHER_API_KEY
        if (!apiKey) return "weather is not configured: set WEATHER_API_KEY in the environment."
        // A real tool would call the weather API here with `apiKey`.
        return `The weather in ${data.city} is fine. (example — wire a real API call here)`
      },
    })
    return { tools: [weatherLookup] }
  },
}
