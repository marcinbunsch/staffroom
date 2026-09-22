import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The auth secret. A self-hosted install should start with no configuration,
 * which means generating one — and the only thing that makes a generated
 * secret usable is that it is the *same* one next boot.
 */

let home: string
const savedEnvironment = process.env.STAFFROOM_AUTH_SECRET

// STAFFROOM_HOME is read at module load, so each case re-evaluates config.ts
// against its own temp directory.
async function loadConfig(directory: string) {
  process.env.STAFFROOM_HOME = directory
  vi.resetModules()
  return await import("../src/core/config.ts")
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "staffroom-config-"))
  delete process.env.STAFFROOM_AUTH_SECRET
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  if (savedEnvironment === undefined) delete process.env.STAFFROOM_AUTH_SECRET
  else process.env.STAFFROOM_AUTH_SECRET = savedEnvironment
})

describe("the auth secret", () => {
  it("generates one when nothing is configured", async () => {
    const { resolveAuthSecret } = await loadConfig(home)
    const secret = resolveAuthSecret()

    expect(secret).toHaveLength(43) // 32 random bytes, base64url
    expect(readFileSync(join(home, "auth-secret"), "utf8")).toBe(secret)
  })

  /**
   * The one that matters. A secret regenerated per boot would invalidate every
   * signed session, so restarting the server would quietly sign everyone out.
   */
  it("returns the same secret on the next boot", async () => {
    const { resolveAuthSecret } = await loadConfig(home)
    expect(resolveAuthSecret()).toBe(resolveAuthSecret())
  })

  it("keeps the generated secret private", async () => {
    const { resolveAuthSecret } = await loadConfig(home)
    resolveAuthSecret()

    expect(statSync(join(home, "auth-secret")).mode & 0o777).toBe(0o600)
  })

  // How a deployment keeps the secret in its own secret store, or shares one
  // across several machines.
  it("prefers the environment and writes nothing", async () => {
    process.env.STAFFROOM_AUTH_SECRET = "  a-configured-secret  "
    const { resolveAuthSecret } = await loadConfig(home)

    expect(resolveAuthSecret()).toBe("a-configured-secret")
    expect(() => readFileSync(join(home, "auth-secret"))).toThrow()
  })

  it("ignores an empty environment variable rather than signing with it", async () => {
    process.env.STAFFROOM_AUTH_SECRET = "   "
    const { resolveAuthSecret } = await loadConfig(home)

    expect(resolveAuthSecret()).toHaveLength(43)
  })
})
