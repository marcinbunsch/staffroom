import { addPlugin, startServer } from "@staffroom/server/lib"
import { plugin } from "./src/plugin.ts"

/**
 * The deployment entry point. Register every plugin, then start the server — the
 * order matters: the server reads the plugin registry as it boots, so a plugin
 * added after `startServer` would be invisible.
 *
 * Run this in server mode with the deployment's own environment:
 *
 *   node --env-file=.env index.ts
 *
 * (Node ≥26 runs TypeScript directly. The default `node dist/server.mjs` entry
 * starts the server with no plugins; this custom entry is the only way to install
 * them.)
 */
addPlugin(plugin)
await startServer()
