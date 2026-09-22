import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { packager } from "@electron/packager"

/**
 * Build a real, installable Staffroom.app.
 *
 * The app is the Electron shell (main + preloads + html), packaged from this
 * directory, plus the local server it can run (see ../local-server.mjs). That
 * server is staged under out/ first and ships as an extra resource
 * (`Resources/server`), outside the app's asar archive, because its native addon
 * has to load from a real file: the Flue app bundled with its dependencies, its
 * loopback-only `entry.mjs`, the built UI (all from `pnpm build:desktop`), and
 * better-sqlite3 with only the target's native addon.
 *
 * The app is signed with the Developer ID and optionally notarized, all driven by
 * env so an unsigned build needs nothing:
 *
 *   STAFF_SIGN_IDENTITY      — "Developer ID Application: … (TEAMID)"; enables signing
 *   STAFF_SIGN_APP_PASSWORD  — app-specific password; enables notarization
 *   STAFF_SIGN_APPLE_ID      — Apple ID the password belongs to (notarization)
 *   STAFF_SIGN_TEAM_ID       — override the team id (else parsed from the identity)
 *   STAFF_PACK_PLATFORM      — darwin (default) or linux; signing is darwin-only
 *   STAFF_PACK_ARCH          — defaults to this machine's
 *
 * These live in .env at the repo root (gitignored). A value already set in the
 * environment wins, so `STAFF_SIGN_IDENTITY=… pnpm --filter @staffroom/desktop pack`
 * still overrides the file.
 */

const desktopDir = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
const outDir = join(desktopDir, "out")

async function main() {
  loadSigningEnv()
  const platform = process.env.STAFF_PACK_PLATFORM ?? "darwin"
  const arch = process.env.STAFF_PACK_ARCH ?? process.arch
  console.log(`[pack] building Staffroom.app (${platform}-${arch}) …`)
  const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version
  const serverDir = stageLocalServer(platform, arch)
  const paths = await withoutIconComposerNoise(() =>
    packager({
      dir: desktopDir,
      extraResource: [serverDir],
      out: outDir,
      name: "Staffroom",
      platform,
      arch,
      ...(platform === "darwin" ? { icon: join(desktopDir, "assets/icon.icns") } : {}),
      appBundleId: "com.staffroom.desktop",
      appVersion: version,
      appCategoryType: "public.app-category.productivity",
      overwrite: true,
      prune: false, // the shell imports only electron + node builtins
      // Everything the app doesn't run from. The shell needs no node_modules
      // (electron is the runtime, not a bundled dep), and the build plumbing
      // and prior output must never end up inside the .app. The local server
      // comes in as the extra resource above, not from here.
      ignore: [
        /^\/assets($|\/)/,
        /^\/out($|\/)/,
        /^\/scripts($|\/)/,
        /^\/node_modules($|\/)/,
        /^\/README\.md$/,
      ],
      ...(platform === "darwin" ? signingOptions() : {}),
    }),
  )
  console.log(`[pack] done → ${paths.join(", ")}`)
  return paths
}

/** Stage the local server under out/ — everything it runs from, and nothing else. */
function stageLocalServer(platform, arch) {
  const serverBundle = join(repoRoot, "packages/server/dist-desktop")
  const uiDist = join(repoRoot, "packages/ui/dist")
  if (!existsSync(join(serverBundle, "app.mjs")) || !existsSync(join(uiDist, "index.html"))) {
    throw new Error("the local server or the UI is not built — run `pnpm build:desktop` first")
  }

  const serverDir = join(outDir, "stage", "server")
  rmSync(join(outDir, "stage"), { recursive: true, force: true })
  mkdirSync(serverDir, { recursive: true })
  // The bundled Flue app, without source maps and without Flue's own server.mjs,
  // which listens on every interface: the app starts entry.mjs, loopback only.
  cpSync(serverBundle, serverDir, {
    recursive: true,
    filter: (path) => !path.endsWith(".map") && path !== join(serverBundle, "server.mjs"),
  })
  cpSync(join(repoRoot, "packages/server/desktop/entry.mjs"), join(serverDir, "entry.mjs"))
  cpSync(uiDist, join(serverDir, "ui"), { recursive: true })
  stageSqlite(join(serverDir, "node_modules", "better-sqlite3"), platform, arch)
  console.log(`[pack] staged the local server → ${serverDir}`)
  return serverDir
}

/**
 * better-sqlite3 stays outside the server bundle: it loads its native addon from
 * a path relative to its own files. Copy only what it runs from — package.json,
 * lib/, and the prebuilt addon for the target. The prebuilds are N-API, so the
 * one addon loads in Electron's Node as well as plain Node. On Linux both the
 * glibc and musl builds go in; the library picks one at runtime.
 */
function stageSqlite(dest, platform, arch) {
  const source = realpathSync(join(repoRoot, "packages/server/node_modules/better-sqlite3"))
  const targets =
    platform === "linux" ? [`linux-${arch}`, `linuxmusl-${arch}`] : [`${platform}-${arch}`]
  if (!existsSync(join(source, "prebuilds", `${targets[0]}.node`))) {
    throw new Error(`better-sqlite3 has no prebuilt addon for ${targets[0]}`)
  }
  mkdirSync(join(dest, "prebuilds"), { recursive: true })
  for (const file of ["package.json", "LICENSE"]) cpSync(join(source, file), join(dest, file))
  cpSync(join(source, "lib"), join(dest, "lib"), { recursive: true })
  for (const target of targets) {
    const addon = join(source, "prebuilds", `${target}.node`)
    if (existsSync(addon)) cpSync(addon, join(dest, "prebuilds", `${target}.node`))
  }
}

/**
 * Load signing vars from .env at the repo root so they need not be typed on
 * every build. Values already in the environment win. The file holds
 * credentials and is gitignored.
 */
function loadSigningEnv() {
  const path = join(repoRoot, ".env")
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const body = line.startsWith("export ") ? line.slice(7) : line
    const eq = body.indexOf("=")
    if (eq === -1) continue
    const key = body.slice(0, eq).trim()
    let value = body.slice(eq + 1).trim()
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
  console.log("[pack] loaded signing config from .env")
}

/**
 * Signing and notarization, driven entirely by env so an unsigned build is the
 * default and needs no secrets. Notarization runs only when both the app
 * password and an Apple ID are present; the team id is parsed from the identity
 * (the "(TEAMID)" suffix) unless overridden. Set STAFF_PACK_SKIP_NOTARIZE to
 * still sign but skip the slow Apple round-trip — enough for a local install.
 */
function signingOptions() {
  const identity = process.env.STAFF_SIGN_IDENTITY
  if (!identity) return {}

  const options = { osxSign: { identity } }
  const appleId = process.env.STAFF_SIGN_APPLE_ID
  const appleIdPassword = process.env.STAFF_SIGN_APP_PASSWORD
  const teamId = process.env.STAFF_SIGN_TEAM_ID ?? identity.match(/\(([^)]+)\)\s*$/)?.[1]
  if (appleId && appleIdPassword && teamId && !process.env.STAFF_PACK_SKIP_NOTARIZE) {
    options.osxNotarize = { appleId, appleIdPassword, teamId }
  }
  console.log(`[pack] signing as ${identity}${options.osxNotarize ? " + notarizing" : ""}`)
  return options
}

/**
 * Packager 20 probes for a macOS 26 Icon Composer ".icon" beside the ".icns"
 * and warns when there isn't one — though it uses the ".icns" fine, which is all
 * we ship. Drop that single warning line rather than going `quiet` on the whole
 * build.
 */
async function withoutIconComposerNoise(run) {
  const warn = console.warn
  console.warn = (...args) => {
    if (typeof args[0] === "string" && args[0].includes("skipping this app icon format")) return
    warn.apply(console, args)
  }
  try {
    return await run()
  } finally {
    console.warn = warn
  }
}

main().catch((error) => {
  console.error(`[pack] failed: ${error.message}`)
  process.exit(1)
})
