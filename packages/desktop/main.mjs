import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  ipcMain,
  Menu,
  session,
  shell,
} from "electron"
import {
  LOCAL_TOKEN_HEADER,
  localDataPath,
  localLogPath,
  onLocalServerExit,
  startLocalServer,
  stopLocalServer,
} from "./local-server.mjs"

/**
 * The Staffroom desktop shell — a thin Electron client over Staffroom servers.
 *
 * It holds no app logic: each account opens its server's own URL in a window, so
 * the exact web UI the server serves runs unchanged, cookie-authenticated
 * same-origin (the window's origin *is* the server). The one thing the shell
 * adds is an account switcher: several accounts, each pinned to its own
 * persistent Electron session partition, so their cookies — and therefore their
 * logins — never mix. Switching between them is instant because each account
 * keeps its own warm window.
 *
 * An account is either remote — a label + the URL of a server that is already
 * running — or the one local account, backed by a server this app runs itself
 * (local-server.mjs). The local server runs only once that account exists. From
 * then on it starts with the app and runs until the app quits, whichever account
 * is open, so its routines and jobs carry on. An app that only ever connects to
 * remote servers never starts it.
 */

const here = dirname(fileURLToPath(import.meta.url))

// The Vite dev-server URL, set by `pnpm dev:desktop`. When present, account
// windows load the hot-reloading local UI from here instead of the account's own
// server — but each window still targets *its* account's server (the switcher
// works as normal), because a per-partition header tells Vite's dev proxy where
// to route the API. Absent in a normal/packaged run.
const DEV_URL = process.env.STAFFROOM_DESKTOP_DEV_URL?.trim()

// A distinct name (and so a distinct userData dir + partitions) when run from
// source, so a dev session never clobbers a packaged install's accounts.
app.setName(app.isPackaged ? "Staffroom" : "Staffroom Dev")

/**
 * account: { id, label, url } for a remote server, or { id, label, kind: "local" }
 * for the local one (there is at most one). store: { list: account[], lastUsed?: id }.
 */
function storePath() {
  return join(app.getPath("userData"), "accounts.json")
}

function readStore() {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8"))
    return { list: Array.isArray(parsed.list) ? parsed.list : [], lastUsed: parsed.lastUsed }
  } catch {
    return { list: [] }
  }
}

function writeStore(store) {
  mkdirSync(dirname(storePath()), { recursive: true })
  writeFileSync(storePath(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
}

function isLocal(account) {
  return account?.kind === "local"
}

function localAccount() {
  return readStore().list.find(isLocal)
}

/** Each account gets its own cookie jar; that is what keeps logins separate. */
function partitionFor(id) {
  return `persist:acct-${id}`
}

/**
 * Normalize a typed server URL: add a scheme if missing, drop a trailing slash.
 * Returns undefined when it is not a usable http(s) URL.
 */
function normalizeUrl(raw) {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return undefined
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.toString().replace(/\/+$/, "")
  } catch {
    return undefined
  }
}

/** Plain http is only allowed to localhost; anything else must be https. */
function isAllowed(url) {
  const parsed = new URL(url)
  if (parsed.protocol === "https:") return true
  return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
}

/** Confirm a Staffroom server actually answers at the URL before saving it. */
async function verifyReachable(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" })
    // Any HTTP answer means something is listening; the SPA is served at "/".
    return response.status > 0
  } catch (error) {
    return error instanceof Error ? error.message : "unreachable"
  } finally {
    clearTimeout(timer)
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

const windows = new Map() // accountId -> BrowserWindow
// Electron's application badge is shared by every account window. Keep each
// window's latest counts here, then show their sum rather than letting the last
// window to report erase another account's outstanding work.
const accountBadges = new Map() // accountId -> { unread: number, attention: number }
let launcher

function updateBadge() {
  const count = [...accountBadges.values()].reduce(
    (total, badge) => total + badge.unread + badge.attention,
    0,
  )
  app.setBadgeCount(count)
}

function accountIdForSender(sender) {
  for (const [id, window] of windows) {
    if (!window.isDestroyed() && window.webContents === sender) return id
  }
}

function accountById(id) {
  return readStore().list.find((account) => account.id === id)
}

function markUsed(id) {
  const store = readStore()
  store.lastUsed = id
  const account = store.list.find((entry) => entry.id === id)
  if (account) account.lastUsedAt = new Date().toISOString()
  writeStore(store)
  buildMenu()
}

/**
 * In dev (`pnpm dev:desktop`), tag every request from this account's partition
 * with the account's real server URL. Vite's dev proxy reads that header to send
 * /api, /agents and /oauth to the right server — so the switcher picks the server
 * while the window runs the hot-reloading local UI. Per-partition, so each
 * account's window routes to its own server with its own isolated cookies.
 */
function attachDevTargetHeader(id, target) {
  const partitionSession = session.fromPartition(partitionFor(id))
  partitionSession.webRequest.onBeforeSendHeaders(
    { urls: [`${DEV_URL}/*`] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, "x-staffroom-target": target } })
    },
  )
}

/** A failed load must never be a silent blank screen: show the error, with retry. */
function showError(window, url, error) {
  const search = new URLSearchParams({ url, error }).toString()
  void window.loadFile(join(here, "error.html"), { search }).catch(() => {})
}

function openAccount(id) {
  const account = accountById(id)
  if (!account) return
  const existing = windows.get(id)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    markUsed(id)
    return
  }
  const local = isLocal(account)
  // Dev: load the hot-reloading Vite UI and point its API at this account's
  // server via a per-partition header. Prod: load the account's own URL directly.
  // The local server's URL is only known once it runs; openLocal attaches its own.
  if (DEV_URL && !local) attachDevTargetHeader(id, account.url)

  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 640,
    title: account.label,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      partition: partitionFor(id),
      preload: join(here, local ? "local-preload.cjs" : "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Links to other origins open in the user's browser, not inside the shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })
  let devRetries = 0
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      // In dev, Vite may still be starting up — retry rather than error out.
      if (DEV_URL) {
        if (devRetries++ < 60 && !window.isDestroyed()) {
          setTimeout(() => !window.isDestroyed() && window.loadURL(DEV_URL), 1000)
        }
        return
      }
      // In prod, show the URL and error with retry and a way back to the launcher.
      showError(window, failedUrl, description)
    },
  )
  window.on("closed", () => {
    windows.delete(id)
    accountBadges.delete(id)
    updateBadge()
  })
  windows.set(id, window)
  if (local) {
    void window.loadFile(join(here, "starting.html")).catch(() => {})
    void openLocal(id, window)
  } else {
    void window.loadURL(DEV_URL ?? account.url)
  }
  markUsed(id)
  if (launcher && !launcher.isDestroyed()) launcher.close()
}

/**
 * Show the local account in `window`: start the local server if it is not
 * running, then load its local sign-in with this start's token, which signs the
 * one account in and redirects to the UI.
 */
async function openLocal(id, window) {
  let running
  try {
    running = await startLocalServer()
  } catch (error) {
    if (!window.isDestroyed()) showError(window, "", messageOf(error))
    return
  }
  if (window.isDestroyed()) return
  if (DEV_URL) attachDevTargetHeader(id, running.url)
  // A failed load is reported through did-fail-load.
  await window
    .loadURL(`${DEV_URL ?? running.url}/api/auth/local/sign-in`, {
      extraHeaders: `${LOCAL_TOKEN_HEADER}: ${running.token}\n`,
    })
    .catch(() => {})
}

/** Start the local server with nothing waiting on it (the app launching, a restart). */
function startLocalInBackground() {
  startLocalServer().catch((error) => console.error(`[local-server] ${messageOf(error)}`))
}

async function restartLocalServer() {
  const account = localAccount()
  if (!account) return
  await stopLocalServer()
  const window = windows.get(account.id)
  if (!window || window.isDestroyed()) return startLocalInBackground()
  void window.loadFile(join(here, "starting.html")).catch(() => {})
  await openLocal(account.id, window)
}

// The local account's window shows why its server went away, with Retry.
onLocalServerExit((message) => {
  const account = localAccount()
  const window = account && windows.get(account.id)
  if (window && !window.isDestroyed()) showError(window, "", message)
})

function openLauncher() {
  if (launcher && !launcher.isDestroyed()) {
    launcher.focus()
    return
  }
  launcher = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    title: "Staffroom",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(here, "launcher-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void launcher.loadFile(join(here, "launcher.html"))
}

async function forgetAccount(id) {
  const account = accountById(id)
  const window = windows.get(id)
  if (window && !window.isDestroyed()) window.close()
  windows.delete(id)
  accountBadges.delete(id)
  updateBadge()
  // Forgetting the local account stops its server. Its data stays on disk, so
  // setting the local server up again picks up where it left off.
  if (isLocal(account)) await stopLocalServer()
  // Drop the account's cookies/storage so a re-add starts signed out.
  try {
    await session.fromPartition(partitionFor(id)).clearStorageData()
  } catch {
    // A partition never opened has nothing to clear.
  }
  const store = readStore()
  store.list = store.list.filter((entry) => entry.id !== id)
  if (store.lastUsed === id) store.lastUsed = undefined
  writeStore(store)
  buildMenu()
  return store.list
}

// --- IPC (launcher) --------------------------------------------------------

ipcMain.handle("staffroom:accounts:list", () => readStore())

ipcMain.handle("staffroom:accounts:add", async (_event, input) => {
  const url = normalizeUrl(input?.url)
  if (!url) return { error: "Enter a valid server URL." }
  if (!isAllowed(url)) return { error: "Remote servers must use https." }
  const reachable = await verifyReachable(url)
  if (reachable !== true) return { error: `Could not reach the server (${reachable}).` }

  const store = readStore()
  const label = (input?.label ?? "").trim() || new URL(url).host
  const account = { id: randomUUID(), label, url, lastUsedAt: new Date().toISOString() }
  store.list.push(account)
  writeStore(store)
  buildMenu()
  openAccount(account.id)
  return { ok: true }
})

// Set up the local account — the first time the local server ever starts. There
// is only one, so asking again just opens it.
ipcMain.handle("staffroom:accounts:add-local", () => {
  const existing = localAccount()
  if (existing) {
    openAccount(existing.id)
    return { ok: true }
  }
  const store = readStore()
  const account = {
    id: randomUUID(),
    label: "This computer",
    kind: "local",
    lastUsedAt: new Date().toISOString(),
  }
  store.list.push(account)
  writeStore(store)
  buildMenu()
  openAccount(account.id)
  return { ok: true }
})

ipcMain.handle("staffroom:accounts:open", (_event, id) => {
  openAccount(id)
  return { ok: true }
})

ipcMain.handle("staffroom:accounts:forget", (_event, id) => forgetAccount(id))

ipcMain.handle("staffroom:launcher:open", () => {
  openLauncher()
  return { ok: true }
})

// The renderer never chooses an account id: derive it from its WebContents so
// one signed-in account cannot overwrite another account's badge contribution.
ipcMain.handle("staffroom:badge:set", (event, counts) => {
  const id = accountIdForSender(event.sender)
  if (!id) return { ok: false }
  const unread = Number.isSafeInteger(counts?.unread) ? Math.max(0, counts.unread) : 0
  const attention = Number.isSafeInteger(counts?.attention) ? Math.max(0, counts.attention) : 0
  accountBadges.set(id, { unread, attention })
  updateBadge()
  return { ok: true }
})

// Reload the account in the window that asked (used by the error page).
ipcMain.handle("staffroom:retry", (event) => {
  const id = accountIdForSender(event.sender)
  const account = id && accountById(id)
  if (!account) return
  const window = windows.get(id)
  if (isLocal(account)) void openLocal(id, window)
  else void window.loadURL(account.url)
})

// The local window's UI asks to be signed in again when it finds no session. If
// sign-in is not producing one, that would loop — so a few quick asks in a row
// show the error page instead. Its Retry is always honoured.
const recentSignIns = []
function signInLooping() {
  const now = Date.now()
  while (recentSignIns.length > 0 && now - recentSignIns[0] > 15_000) recentSignIns.shift()
  recentSignIns.push(now)
  return recentSignIns.length > 3
}

ipcMain.handle("staffroom:local:sign-in", (event) => {
  const id = accountIdForSender(event.sender)
  if (!id || !isLocal(accountById(id))) return { ok: false }
  const window = windows.get(id)
  if (signInLooping()) {
    showError(window, "", `Signing in to the local server keeps failing. See ${localLogPath()}.`)
    return { ok: false }
  }
  void openLocal(id, window)
  return { ok: true }
})

// "Copy as file": a web page can only put text on the clipboard, so the UI hands
// the shell a file's name and text; the shell writes it to a temp folder and puts
// a reference to that file on the clipboard, the way a file manager's Copy does —
// so it pastes into other apps as an attachment. The copies must outlive the
// paste (a file manager reads them only then), so they are cleared on the next
// launch rather than right away.
const execFileAsync = promisify(execFile)
const clipboardDir = () => join(app.getPath("temp"), "staffroom-clipboard")

ipcMain.handle("staffroom:clipboard:copy-file", async (_event, input) => {
  const name = basename(String(input?.name ?? "")).replace(/[\\/:*?"<>|\0]/g, "_")
  if (!name || name === "." || name === ".." || typeof input?.text !== "string")
    return { ok: false, error: "Not a file to copy." }
  try {
    const dir = join(clipboardDir(), randomUUID())
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, input.text)
    await putFileOnClipboard(path)
    return { ok: true }
  } catch (error) {
    console.error("[clipboard] copy as file failed:", error)
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// Electron's clipboard only writes web types (text, HTML, images), so a file
// reference goes on by the platform's own means. On macOS that is AppleScript's
// `set the clipboard to POSIX file`, which is what Finder's Copy puts there.
async function putFileOnClipboard(path) {
  if (process.platform === "darwin") {
    await execFileAsync("osascript", [
      "-e",
      "on run argv",
      "-e",
      "set the clipboard to ((item 1 of argv) as POSIX file)",
      "-e",
      "end run",
      path,
    ])
  } else if (process.platform === "linux") {
    const uriList = `${pathToFileURL(path).href}\r\n`
    await clipboard.write([
      new ClipboardItem({
        'electron application/osclipboard;format="text/uri-list"': new Blob([uriList]),
      }),
    ])
  } else {
    throw new Error(`Copying files is not supported on ${process.platform}.`)
  }
}

// --- Menu ------------------------------------------------------------------

function buildMenu() {
  const accounts = readStore().list
  const accountItems = accounts.map((account, index) => ({
    label: account.label,
    accelerator: index < 9 ? `CmdOrCtrl+Shift+${index + 1}` : undefined,
    click: () => openAccount(account.id),
  }))

  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "Accounts",
      submenu: [
        ...(accountItems.length > 0
          ? accountItems
          : [{ label: "No accounts yet", enabled: false }]),
        { type: "separator" },
        { label: "Add Account…", click: () => openLauncher() },
        {
          label: "Manage Accounts…",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => openLauncher(),
        },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // Only once the local server exists — an app with remote accounts only has
    // no server to manage.
    ...(accounts.some(isLocal)
      ? [
          {
            label: "Local Server",
            submenu: [
              { label: "Restart Local Server", click: () => void restartLocalServer() },
              { type: "separator" },
              { label: "Show Server Log", click: () => void shell.openPath(localLogPath()) },
              { label: "Show Data Folder", click: () => void shell.openPath(localDataPath()) },
            ],
          },
        ]
      : []),
    {
      label: "Window",
      // The `windowMenu` role's default submenu has no Close item on macOS, and
      // there is no File menu. ⌘W is reserved for the renderer (it closes the
      // open chat tab, browser-style), so window close moves to ⇧⌘W — otherwise
      // the menu accelerator would swallow ⌘W before the web contents saw it.
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close", accelerator: "CmdOrCtrl+Shift+W" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// --- Lifecycle -------------------------------------------------------------

let quitting = "no" // "no" → "stopping" (the local server) → "done"

if (!app.requestSingleInstanceLock()) {
  // Another instance is running — and may own the local server and its data. It
  // brings a window forward instead.
  app.quit()
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed())
    if (!window) return openLauncher()
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    rmSync(clipboardDir(), { recursive: true, force: true })
    buildMenu()
    // Once the local account exists its server runs with the app, whichever
    // account opens first.
    if (localAccount()) startLocalInBackground()
    const store = readStore()
    if (store.lastUsed && accountById(store.lastUsed)) openAccount(store.lastUsed)
    else openLauncher()

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) openLauncher()
    })
  })

  app.on("window-all-closed", () => {
    // On macOS an app stays running with no windows — and so does the local
    // server, if there is one. Elsewhere it quits.
    if (process.platform !== "darwin") app.quit()
  })

  // Quitting waits for the local server to stop, so it drains rather than dies.
  app.on("before-quit", (event) => {
    app.setBadgeCount(0)
    if (quitting === "done") return
    event.preventDefault()
    if (quitting === "stopping") return
    quitting = "stopping"
    void stopLocalServer().finally(() => {
      quitting = "done"
      app.quit()
    })
  })
}
