/**
 * The server entry for the desktop app's local server, which the app runs as an
 * Electron utility process (see packages/desktop/local-server.mjs).
 *
 * Unlike the Flue build's own `dist/server.mjs`, which listens on every
 * interface, this binds loopback and nothing else — the app's server must not be
 * reachable from the network — and it refuses to start unless the server is in
 * single-user mode. It tells the app when it is listening, and stops gracefully
 * when the app asks (a message works on every platform; signals do not).
 *
 * In a packed app this file sits beside the Flue app that `build:desktop` bundles
 * with every dependency (`dist-desktop/app.mjs`); run from source, it loads the
 * workspace build (`dist/app.mjs`).
 */
import { existsSync } from "node:fs"

const HOST = "127.0.0.1"

const port = Number.parseInt(process.env.PORT ?? "", 10)
if (!Number.isInteger(port) || port <= 0) throw new Error("[staffroom] PORT is required")
if (process.env.STAFFROOM_SINGLE_USER !== "1") {
  throw new Error("[staffroom] the desktop server runs single-user only (STAFFROOM_SINGLE_USER=1)")
}

const bundledApp = new URL("./app.mjs", import.meta.url)
const appModule = existsSync(bundledApp) ? bundledApp : new URL("../dist/app.mjs", import.meta.url)
const { startFlueNodeServer } = await import(appModule.href)

const lifecycle = await startFlueNodeServer({ port, hostname: HOST })
const parent = process.parentPort
parent?.postMessage({ type: "listening", url: `http://${HOST}:${port}` })

let stopping = false
async function stop(exitCode) {
  if (stopping) return
  stopping = true
  setTimeout(() => {
    console.error("[staffroom] Shutdown timed out, exiting.")
    process.exit(exitCode)
  }, 10_000).unref()
  await lifecycle.stop()
  process.exit(exitCode)
}

parent?.on("message", (event) => {
  if (event.data?.type === "stop") void stop(0)
})
process.on("SIGINT", () => void stop(130))
process.on("SIGTERM", () => void stop(143))
