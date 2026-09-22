/**
 * The library face of `@staffroom/server`, for a deployment that runs Staffroom
 * with its own custom plugins. Such a deployment is a small separate entry file:
 *
 *   import { addPlugin, startServer } from "@staffroom/server/lib"
 *   import { plugin } from "./my-plugin.ts"
 *
 *   addPlugin(plugin)
 *   await startServer()
 *
 * run with `node --env-file=.env index.ts` so the plugin's tools can read their
 * configuration from `process.env`.
 *
 * The default server (`node serve.mjs`) does not use this entry — it starts
 * with no plugins. This exists only so a deployment can register plugins
 * *before* the server boots. `addPlugin` is re-exported from `@staffroom/plugin-
 * core` rather than reimplemented, so a deployment and the running agent share
 * one registry instance (the Flue build externalizes both packages — see the
 * plugin-core header).
 */
export { addPlugin, definePlugin } from "@staffroom/plugin-core"
export type { IntegrationTypeDef, StaffPlugin } from "@staffroom/plugin-core"

/** What Flue's built application artifact (`dist/app.mjs`) exposes to us. */
interface FlueNodeServer {
  startFlueNodeServer(options: { port: number; hostname?: string }): Promise<FlueNodeLifecycle>
}

interface FlueNodeLifecycle {
  stop(): Promise<void>
}

export interface StartServerOptions {
  /** Port to listen on. Defaults to `process.env.PORT`, then 4317. */
  port?: number
  /**
   * Address to bind. Defaults to `process.env.STAFFROOM_HOST`, then loopback.
   *
   * Loopback is the default because reaching the wildcard should be a decision
   * someone made: this process holds every tenant's model credentials and OAuth
   * tokens, and the usual deployment fronts it with a reverse proxy or
   * `tailscale serve` anyway, which only needs the loopback port. Set
   * `0.0.0.0` (or a specific interface) to accept connections from elsewhere.
   */
  host?: string
}

/**
 * Boot the Staffroom server. Call this once, after every `addPlugin`. Returns
 * once the server is listening; installs the same SIGINT/SIGTERM/disconnect
 * handling Flue's own production entry uses, so a deployment need not repeat it.
 */
export async function startServer(options: StartServerOptions = {}): Promise<void> {
  const { startFlueNodeServer } = await loadFlueNodeServer()
  const port = options.port ?? Number.parseInt(process.env.PORT || "4317", 10)
  const hostname = options.host ?? (process.env.STAFFROOM_HOST?.trim() || "127.0.0.1")
  const lifecycle = await startFlueNodeServer({ port, hostname })
  installShutdownHandlers(lifecycle)
}

/**
 * Load Flue's non-listening application artifact. `vite build` emits it beside
 * the self-starting `dist/server.mjs`; the annotated return type keeps the
 * dynamic import's `any` from leaking past this boundary.
 */
async function loadFlueNodeServer(): Promise<FlueNodeServer> {
  return import(new URL("../dist/app.mjs", import.meta.url).href)
}

function installShutdownHandlers(lifecycle: FlueNodeLifecycle): void {
  const stop = async (exitCode: number) => {
    // A hung shutdown should still exit; the unref'd timer does not keep the
    // process alive on its own.
    setTimeout(() => {
      console.error("[staffroom] Shutdown timed out, exiting.")
      process.exit(exitCode)
    }, 60_000).unref()
    await lifecycle.stop()
    process.exit(exitCode)
  }
  process.on("SIGINT", () => void stop(130))
  process.on("SIGTERM", () => void stop(143))
  process.on("disconnect", () => void stop(0))
}
