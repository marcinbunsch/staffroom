import { randomBytes } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app, utilityProcess } from "electron"

/**
 * The local server — a Staffroom server this app runs itself, behind the one
 * local account in the switcher (see main.mjs):
 *
 * - **An Electron utility process.** Electron's own Node runs it, so there is no
 *   second runtime to ship. Its data lives in `<userData>/local-server`, apart
 *   from the `~/.staffroom` a dev server uses.
 * - **Loopback only.** The server binds 127.0.0.1 and nothing else, and refuses
 *   requests that name any other host (DNS rebinding).
 * - **Single-user, signed in by the app.** It runs with `STAFFROOM_SINGLE_USER`:
 *   one account, no sign-up, no teams. For each start this module makes a token
 *   only it and the server know; the account window signs in with it — so the
 *   window is signed in, and a browser pointed at the same port is not.
 */

const here = dirname(fileURLToPath(import.meta.url))

const HOST = "127.0.0.1"
// The first-choice port, kept once chosen: the UI's local storage and any OAuth
// redirect URI registered for an integration are tied to it.
const DEFAULT_PORT = 4327
// Must match LOCAL_TOKEN_HEADER in the server's core/local-sign-in.ts.
export const LOCAL_TOKEN_HEADER = "x-staffroom-local-token"
const STARTUP_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 15_000
// Under `pnpm dev:desktop` the window's origin is the Vite dev server, which a
// production-mode server would not trust for sign-in (better-auth's CSRF guard).
const DEV = Boolean(process.env.STAFFROOM_DESKTOP_DEV_URL?.trim())

/** The running server: { child, url, token } — the token is this start's alone. */
let server
/** The start in flight, so concurrent callers share it. */
let starting
const exitListeners = new Set()

function root(...parts) {
  return join(app.getPath("userData"), "local-server", ...parts)
}

export function localDataPath() {
  return root("data")
}

export function localLogPath() {
  return root("logs", "server.log")
}

/** Called with a message when the server stops without being asked to. */
export function onLocalServerExit(listener) {
  exitListeners.add(listener)
}

/**
 * What to run. A packed app carries the server bundle and the UI as a resource,
 * outside its asar archive so the native addon loads from disk (staged by
 * scripts/pack.mjs); run from source, it uses the workspace's builds.
 */
function layout() {
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, "server")
    return { entry: join(bundled, "entry.mjs"), uiDir: join(bundled, "ui"), requires: [] }
  }
  return {
    entry: join(here, "..", "server", "desktop", "entry.mjs"),
    uiDir: join(here, "..", "ui", "dist"),
    requires: [join(here, "..", "server", "dist", "app.mjs")],
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(root("state.json"), "utf8"))
  } catch {
    return {}
  }
}

function writeState(state) {
  mkdirSync(root(), { recursive: true })
  writeFileSync(root("state.json"), `${JSON.stringify(state, null, 2)}\n`)
}

/** Resolve with the port a probe listener got on loopback, or undefined if it could not listen. */
function probePort(port) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once("error", () => resolve(undefined))
    probe.listen(port, HOST, () => {
      const bound = probe.address().port
      probe.close(() => resolve(bound))
    })
  })
}

/** Last time's port (or the default) if it is free; otherwise any free one, kept for next time. */
async function choosePort() {
  const state = readState()
  const preferred = Number.isInteger(state.port) ? state.port : DEFAULT_PORT
  if ((await probePort(preferred)) === preferred) return preferred
  const port = await probePort(0)
  if (!port) throw new Error(`Could not find a free port on ${HOST}.`)
  writeState({ ...state, port })
  return port
}

/** The server's output, kept one start back: server.log now, server.previous.log before. */
function openLog() {
  mkdirSync(dirname(localLogPath()), { recursive: true })
  if (existsSync(localLogPath())) renameSync(localLogPath(), root("logs", "server.previous.log"))
  return createWriteStream(localLogPath())
}

/** The running server, starting it first if it is not running. */
export function startLocalServer() {
  if (server) return Promise.resolve(server)
  starting ??= start().finally(() => {
    starting = undefined
  })
  return starting
}

async function start() {
  const { entry, uiDir, requires } = layout()
  const missing = [entry, join(uiDir, "index.html"), ...requires].find((path) => !existsSync(path))
  if (missing) throw new Error(`Not built: ${missing} is missing. Run \`pnpm build\` first.`)

  const port = await choosePort()
  const url = `http://${HOST}:${port}`
  const token = randomBytes(32).toString("base64url")
  mkdirSync(localDataPath(), { recursive: true })

  const child = utilityProcess.fork(entry, [], {
    serviceName: "Staffroom Local Server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: DEV ? "development" : "production",
      PORT: String(port),
      STAFFROOM_URL: url,
      STAFFROOM_HOME: localDataPath(),
      STAFFROOM_UI_DIR: uiDir,
      STAFFROOM_SINGLE_USER: "1",
      STAFFROOM_LOCAL_TOKEN: token,
    },
  })
  const log = openLog()
  for (const stream of [child.stdout, child.stderr]) {
    stream?.pipe(log, { end: false })
    if (!app.isPackaged) stream?.pipe(process.stdout, { end: false })
  }

  await new Promise((resolve, reject) => {
    const fail = (message) => {
      clearTimeout(timer)
      child.kill()
      reject(new Error(`${message} See ${localLogPath()}.`))
    }
    const timer = setTimeout(
      () => fail("The local server did not start in time."),
      STARTUP_TIMEOUT_MS,
    )
    child.on("message", (message) => {
      if (message?.type !== "listening") return
      clearTimeout(timer)
      resolve()
    })
    child.once("exit", (code) => fail(`The local server exited while starting (code ${code}).`))
  })

  const started = { child, url, token }
  child.once("exit", (code) => {
    if (server !== started) return // stopped on purpose
    server = undefined
    const message = `The local server stopped unexpectedly (code ${code}). See ${localLogPath()}.`
    for (const listener of exitListeners) listener(message)
  })
  server = started
  return started
}

/** Stop the server if it is running (or starting), gracefully if it will. */
export async function stopLocalServer() {
  await starting?.catch(() => {})
  const running = server
  if (!running) return
  server = undefined
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      running.child.kill()
      resolve()
    }, STOP_TIMEOUT_MS)
    running.child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    // Graceful: the entry drains Flue before it exits.
    try {
      running.child.postMessage({ type: "stop" })
    } catch {
      running.child.kill()
    }
  })
}
