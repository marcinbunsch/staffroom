import {
  pluginIntegrationTypes,
  pluginToolsetTypes,
  registeredPlugins,
} from "@staffroom/plugin-core"
import { BUILTIN_INTEGRATION_TYPES } from "./integrations.ts"
import { BUILTIN_TOOLSET_KINDS } from "../tools/toolset-types.ts"

/**
 * The server side of the plugin contract: the checks a plugin's contributions
 * must pass against the *built-ins* before the server will boot with them.
 *
 * `@staffroom/plugin-core` already rejects plugin-vs-plugin clashes (a duplicate
 * plugin id, integration type, or toolset kind) when `addPlugin` runs. What it
 * cannot see is the server's own built-ins — the five built-in integration types
 * and the built-in toolset kinds — because those live here, not in the shared
 * package. So this closes the other half: a plugin that shadows a built-in fails
 * the boot loudly rather than silently overriding or duplicating it.
 */

/**
 * Fail the boot if any installed plugin shadows a built-in integration type or a
 * built-in toolset kind. Idempotent and side-effect-free — safe to call at boot
 * and directly from a test.
 */
export function assertPluginsCompatible(): void {
  const reservedTypes = new Set(BUILTIN_INTEGRATION_TYPES)
  for (const type of pluginIntegrationTypes()) {
    if (reservedTypes.has(type.type)) {
      throw new Error(
        `plugin integration type "${type.type}" collides with a built-in type; rename it in the plugin`,
      )
    }
  }
  const reservedKinds = new Set(BUILTIN_TOOLSET_KINDS)
  for (const type of pluginToolsetTypes()) {
    if (reservedKinds.has(type.kind)) {
      throw new Error(
        `plugin toolset kind "${type.kind}" collides with a built-in kind; rename it in the plugin`,
      )
    }
  }
}

/** A one-line boot summary of what the installed plugins contribute. */
export function pluginBootSummary(): string {
  const plugins = registeredPlugins()
  if (plugins.length === 0) return "no plugins installed"
  const types = pluginIntegrationTypes().length
  const kinds = pluginToolsetTypes().length
  return `${plugins.length} plugin(s): ${types} integration type(s), ${kinds} toolset kind(s)`
}
