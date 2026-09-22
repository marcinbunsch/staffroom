import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from "node:crypto"
import { describe, expect, it } from "vitest"
import type { WebPushConfig } from "../../src/core/config.ts"
import {
  encryptPayload,
  generateVapidKeys,
  vapidAuthHeader,
  type WebPushSubscription,
} from "../../src/coordinator/web-push.ts"

/** A subscription with a real UA keypair, and the private key to decrypt with. */
function makeSubscription(): { subscription: WebPushSubscription; uaPrivate: Buffer } {
  const ua = createECDH("prime256v1")
  const uaPublic = ua.generateKeys()
  const authSecret = randomBytes(16)
  return {
    uaPrivate: ua.getPrivateKey(),
    subscription: {
      endpoint: "https://push.example.com/subscription-id",
      keys: { p256dh: uaPublic.toString("base64url"), auth: authSecret.toString("base64url") },
    },
  }
}

/**
 * Decrypt an `aes128gcm` body the way a browser would — independently of the
 * source's helpers, so agreement proves the derivation, not a shared bug. Reads
 * the salt and server key from the self-describing header (RFC 8188 §2.1).
 */
function decrypt(body: Buffer, subscription: WebPushSubscription, uaPrivate: Buffer): string {
  const salt = body.subarray(0, 16)
  const idlen = body[20] as number
  const serverPublic = body.subarray(21, 21 + idlen)
  const ciphertext = body.subarray(21 + idlen)

  const ua = createECDH("prime256v1")
  ua.setPrivateKey(uaPrivate)
  const sharedSecret = ua.computeSecret(serverPublic)
  const uaPublic = Buffer.from(subscription.keys.p256dh, "base64url")
  const authSecret = Buffer.from(subscription.keys.auth, "base64url")

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, serverPublic])
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32))
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  )
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  )

  const tag = ciphertext.subarray(ciphertext.length - 16)
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16)
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce)
  decipher.setAuthTag(tag)
  const record = Buffer.concat([decipher.update(encrypted), decipher.final()])
  // Strip the RFC 8188 record delimiter (0x02 for the last-and-only record).
  return record.subarray(0, record.length - 1).toString("utf8")
}

describe("web push encryption", () => {
  it("round-trips a payload a browser could decrypt", () => {
    const { subscription, uaPrivate } = makeSubscription()
    const payload = JSON.stringify({ title: "Devon needs a decision", body: "Ship it?" })

    const body = encryptPayload(subscription, payload)

    expect(decrypt(body, subscription, uaPrivate)).toBe(payload)
  })

  it("prepends the pinned salt and a fresh server key in the header", () => {
    const { subscription } = makeSubscription()
    const salt = randomBytes(16)

    const body = encryptPayload(subscription, "hi", { salt })

    expect(body.subarray(0, 16).equals(salt)).toBe(true)
    // idlen byte, then a 65-byte uncompressed P-256 point.
    expect(body[20]).toBe(65)
    expect(body[21]).toBe(0x04)
  })

  it("produces different ciphertext each time (random salt and key)", () => {
    const { subscription } = makeSubscription()
    const first = encryptPayload(subscription, "same")
    const second = encryptPayload(subscription, "same")
    expect(first.equals(second)).toBe(false)
  })
})

describe("vapid auth header", () => {
  function testConfig(): WebPushConfig {
    const { publicKey, privateKey } = generateVapidKeys()
    return { publicKey, privateKey, subject: "mailto:ops@staffroom.app" }
  }

  it("carries a signed JWT scoped to the endpoint origin, and the public key", () => {
    const config = testConfig()
    const header = vapidAuthHeader(config, "https://push.example.com/abc", 1_700_000_000_000)

    const match = header.match(/^vapid t=([^,]+), k=(.+)$/)
    expect(match).not.toBeNull()
    const [, jwt, key] = match as [string, string, string]
    expect(key).toBe(config.publicKey)

    const [jwtHeader, jwtPayload] = jwt.split(".") as [string, string, string]
    const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"))
    expect(decode(jwtHeader)).toEqual({ typ: "JWT", alg: "ES256" })
    expect(decode(jwtPayload)).toEqual({
      aud: "https://push.example.com",
      sub: "mailto:ops@staffroom.app",
      exp: 1_700_000_000 + 12 * 60 * 60,
    })
  })

  it("signs the JWT with the VAPID key so the public key verifies it", () => {
    const config = testConfig()
    const header = vapidAuthHeader(config, "https://push.example.com/abc")
    const jwt = (header.match(/^vapid t=([^,]+),/) as [string, string])[1]
    const [h, p, signature] = jwt.split(".") as [string, string, string]

    const point = Buffer.from(config.publicKey, "base64url")
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33, 65).toString("base64url"),
      },
    })
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    )
    expect(ok).toBe(true)
  })
})
