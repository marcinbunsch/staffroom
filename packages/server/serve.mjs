/** Start the production server with Staffroom's safe host and port defaults. */
import { startFlueNodeServer } from "./dist/app.mjs"

const port = Number.parseInt(process.env.PORT || "4317", 10)
const hostname = process.env.STAFFROOM_HOST?.trim() || "127.0.0.1"
const lifecycle = await startFlueNodeServer({ port, hostname })

async function stop(exitCode) {
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
