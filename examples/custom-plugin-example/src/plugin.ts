import { definePlugin } from "@staffroom/plugin-core"
import { acmeIntegration } from "./acme-integration.ts"
import { notesToolset } from "./notes-toolset.ts"
import { weatherToolset } from "./weather-toolset.ts"

/**
 * A worked example of a Staffroom plugin, as its own project outside the
 * monorepo. Copy this directory to start your own private plugin — custom
 * contributions do not belong in the open-source repo (see
 * docs/primers/plugins.md).
 *
 * A plugin contributes two kinds of thing, each installed/uninstalled as a unit:
 *
 * - `integrationTypes` — a provider an admin connects (src/acme-integration.ts)
 * - `toolsetTypes`     — toolset kinds; a tool only exists inside one, so it is
 *   installed and uninstalled as a toolset:
 *     - `weather` — the simplest kind: just a tool (src/weather-toolset.ts)
 *     - `notes`   — a URL-backed kind (src/notes-toolset.ts)
 */
export const plugin = definePlugin({
  id: "example",
  integrationTypes: [acmeIntegration],
  toolsetTypes: [weatherToolset, notesToolset],
})
