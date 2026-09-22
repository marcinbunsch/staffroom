import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

/**
 * The credential store is the CLI's whole "auth" contract: several named
 * accounts, one of them default, and a key that never has to be world-readable.
 * `config.ts` reads its home from the environment at import time, so this sets
 * STAFFROOM_HOME first and imports it dynamically.
 */
const home = mkdtempSync(join(tmpdir(), "staffroom-cli-cfg-"))
process.env.STAFFROOM_HOME = home

const { loadCredentials, saveCredentials, resolveAccount, maskKey, credentialsPath } =
  await import("../src/config.ts")

afterAll(() => rmSync(home, { recursive: true, force: true }))

describe("credential store", () => {
  it("returns an empty set before anything is saved", () => {
    expect(loadCredentials()).toEqual({ accounts: {} })
  })

  it("round-trips accounts and the default", () => {
    saveCredentials({
      default: "prod",
      accounts: {
        prod: { url: "https://prod.example", key: "key-prod" },
        staging: { url: "https://staging.example", key: "key-staging" },
      },
    })
    const loaded = loadCredentials()
    expect(loaded.default).toBe("prod")
    expect(Object.keys(loaded.accounts).sort()).toEqual(["prod", "staging"])
  })

  it("writes the secrets file at mode 0600", () => {
    // The whole reason the store lives outside the repo and not in plain sight:
    // it holds usable keys, so it must not be readable by other users.
    expect(statSync(credentialsPath).mode & 0o777).toBe(0o600)
  })

  describe("resolveAccount", () => {
    const credentials = {
      default: "prod",
      accounts: {
        prod: { url: "https://prod.example", key: "key-prod" },
        staging: { url: "https://staging.example", key: "key-staging" },
      },
    }

    it("uses the default when no name is given", () => {
      expect(resolveAccount(credentials, undefined).url).toBe("https://prod.example")
    })

    it("uses an explicit name over the default", () => {
      expect(resolveAccount(credentials, "staging").url).toBe("https://staging.example")
    })

    it("errors when the named account is unknown", () => {
      expect(() => resolveAccount(credentials, "nope")).toThrow(/Unknown account/)
    })

    it("errors when nothing is selected and there is no default", () => {
      expect(() => resolveAccount({ accounts: {} }, undefined)).toThrow(/No account selected/)
    })
  })

  it("masks a key to something recognisable but unusable", () => {
    expect(maskKey("abcdefghijklmnop")).toBe("abcdef…op")
    expect(maskKey("short")).toBe("…")
  })
})
