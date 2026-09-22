import { describe, expect, it } from "vitest"
import {
  SecretDecryptionError,
  decryptSecret,
  encryptSecret,
} from "../../src/coordinator/secrets.ts"

const KEY = "a-test-encryption-key"

describe("secrets at rest", () => {
  it("round-trips a secret", () => {
    expect(decryptSecret(encryptSecret("sk-ant-secret", KEY), KEY)).toBe("sk-ant-secret")
  })

  it("round-trips a token record, and unicode in it", () => {
    const record = JSON.stringify({ tokens: { access_token: "ey.ø", refresh_token: "r✓" } })
    expect(decryptSecret(encryptSecret(record, KEY), KEY)).toBe(record)
  })

  // A fresh IV per write, so two identical keys do not produce identical
  // ciphertext — otherwise the database would leak which colleagues share one.
  it("encrypts the same value differently every time", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY))
  })

  it("refuses a secret encrypted under a different key", () => {
    const encrypted = encryptSecret("sk-ant-secret", KEY)
    expect(() => decryptSecret(encrypted, "another-key")).toThrow(SecretDecryptionError)
  })

  // GCM's auth tag is the point: a tampered record must fail, not decrypt to
  // something else.
  it("refuses a tampered record", () => {
    const [version, iv, tag, ciphertext] = encryptSecret("sk-ant-secret", KEY).split(".")
    const flipped = `${ciphertext?.slice(0, -2)}${ciphertext?.endsWith("aa") ? "bb" : "aa"}`
    expect(() => decryptSecret(`${version}.${iv}.${tag}.${flipped}`, KEY)).toThrow(
      SecretDecryptionError,
    )
  })

  it("refuses anything that is not in the stored format", () => {
    for (const bad of ["", "plaintext", "v2.a.b.c", "v1.only-two.parts"]) {
      expect(() => decryptSecret(bad, KEY), bad).toThrow(SecretDecryptionError)
    }
  })

  it("carries a version, so the format can change later", () => {
    expect(encryptSecret("x", KEY).startsWith("v1.")).toBe(true)
  })
})
