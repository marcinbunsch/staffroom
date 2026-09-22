import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Install the packed Staffroom.app into ~/Applications.
 *
 * `pack.mjs` builds `out/Staffroom-darwin-<arch>/Staffroom.app`; this copies that
 * bundle into the user's personal Applications folder (created if missing),
 * replacing any prior install. Run after `pack` — `pnpm desktop:install` chains
 * both.
 */

const desktopDir = fileURLToPath(new URL("..", import.meta.url))
const outDir = join(desktopDir, "out")
const appName = "Staffroom.app"

function findPackedApp() {
  if (!existsSync(outDir)) return null
  for (const entry of readdirSync(outDir)) {
    // out/Staffroom-darwin-<arch>/Staffroom.app
    const candidate = join(outDir, entry, appName)
    if (entry.startsWith("Staffroom-darwin-") && existsSync(candidate)) return candidate
  }
  return null
}

function main() {
  const source = findPackedApp()
  if (!source) {
    console.error(`[install] no packed app found under ${outDir} — run pack first`)
    process.exit(1)
  }

  const appsDir = join(homedir(), "Applications")
  mkdirSync(appsDir, { recursive: true })
  const dest = join(appsDir, appName)

  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  cpSync(source, dest, { recursive: true, verbatimSymlinks: true })
  console.log(`[install] installed → ${dest}`)
}

main()
