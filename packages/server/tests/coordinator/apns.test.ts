import { generateKeyPairSync, verify } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { resetProviderJwt, signProviderJwt } from "../../src/coordinator/apns.ts"
import type { ApnsConfig } from "../../src/core/config.ts"

/** A throwaway P-256 credential, the shape of a real `.p8` (PKCS#8 PEM). */
function testConfig(overrides: Partial<ApnsConfig> = {}): ApnsConfig {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  })
  return {
    key: privateKey,
    keyId: "ABC1234567",
    teamId: "TEAM123456",
    bundleId: "com.staffroom.app",
    production: false,
    // Stash the matching public key for the signature check.
    ...({ publicKey } as unknown as Partial<ApnsConfig>),
    ...overrides,
  }
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
}

afterEach(() => resetProviderJwt())

describe("apns provider jwt", () => {
  it("signs an ES256 token with the key id and team as issuer", () => {
    const config = testConfig()
    const token = signProviderJwt(config, 1_700_000_000_000)
    const [header, payload] = token.split(".") as [string, string, string]

    expect(decodeSegment(header)).toEqual({ alg: "ES256", kid: "ABC1234567" })
    expect(decodeSegment(payload)).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 })
  })

  it("produces a signature the matching public key verifies", () => {
    const config = testConfig()
    const publicKey = (config as unknown as { publicKey: string }).publicKey
    const token = signProviderJwt(config)
    const [header, payload, signature] = token.split(".") as [string, string, string]

    const ok = verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    )
    expect(ok).toBe(true)
  })

  it("reuses a cached token within the hour rather than re-signing", () => {
    const config = testConfig()
    const first = signProviderJwt(config, 1_700_000_000_000)
    const second = signProviderJwt(config, 1_700_000_000_000 + 60_000)
    expect(second).toBe(first)
  })

  it("re-signs once the cached token ages past its window", () => {
    const config = testConfig()
    const first = signProviderJwt(config, 1_700_000_000_000)
    const later = signProviderJwt(config, 1_700_000_000_000 + 51 * 60 * 1000)
    expect(later).not.toBe(first)
  })
})
