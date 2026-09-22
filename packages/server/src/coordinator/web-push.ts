import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto"
import type { WebPushConfig } from "../core/config.ts"

/**
 * A minimal Web Push client — VAPID auth and RFC 8291 payload encryption, no
 * dependency.
 *
 * Web push is two specs stacked. VAPID (RFC 8292) proves the sender: a
 * short-lived ES256 JWT, audience = the push endpoint's origin, signed with the
 * application server's P-256 key. Message encryption (RFC 8291, `aes128gcm`
 * content coding of RFC 8188) keeps the payload private end-to-end: an ECDH
 * against the subscription's public key, run through HKDF into an AES-128-GCM
 * key. Both are Node built-ins (`crypto` for ECDH/HKDF/GCM and the JWT, global
 * `fetch` for the POST), so this needs nothing from npm.
 *
 * The one dependency this deliberately avoids — the `web-push` package — is
 * replaced by keeping the crypto testable: {@link encryptPayload} takes the
 * salt and server key as options, so a test can pin them and decrypt the result
 * back to the plaintext (see `web-push.test.ts`).
 */

/** A browser's push subscription, as `PushManager.subscribe` yields it. */
export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** The JSON a service worker's `push` handler reads to show a notification. */
export interface WebPushAlert {
  title: string
  body: string
  badge?: number
  threadId?: string
  data?: Record<string, string>
}

export interface WebPushResult {
  status: number
  /** The subscription is gone (404/410) — the caller should purge it. */
  gone: boolean
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

/**
 * Generate a fresh VAPID keypair, base64url-encoded — public key is the
 * uncompressed EC point, private key the raw 32-byte scalar. Matches the format
 * the browser and the `web-push` CLI use, so keys are interchangeable.
 */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    publicKeyEncoding: { type: "spki", format: "jwk" },
    privateKeyEncoding: { type: "pkcs8", format: "jwk" },
  }) as unknown as { publicKey: { x: string; y: string }; privateKey: { d: string } }
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(publicKey.x, "base64url"),
    Buffer.from(publicKey.y, "base64url"),
  ])
  return { publicKey: base64url(point), privateKey: privateKey.d }
}

/** Rebuild the EC signing key from the base64url VAPID pair, via a JWK. */
function vapidKey(config: WebPushConfig) {
  const point = Buffer.from(config.publicKey, "base64url")
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: base64url(point.subarray(1, 33)),
      y: base64url(point.subarray(33, 65)),
      d: config.privateKey,
    },
  })
}

/** The VAPID `Authorization` header for one endpoint's origin. */
export function vapidAuthHeader(config: WebPushConfig, endpoint: string, now = Date.now()): string {
  const audience = new URL(endpoint).origin
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }))
  // Push services cap `exp` at 24h out; 12h is the usual, comfortable choice.
  const exp = Math.floor(now / 1000) + 12 * 60 * 60
  const payload = base64url(JSON.stringify({ aud: audience, exp, sub: config.subject }))
  const signingInput = `${header}.${payload}`
  const signature = createSign("sha256")
    .update(signingInput)
    .sign({ key: vapidKey(config), dsaEncoding: "ieee-p1363" })
  const jwt = `${signingInput}.${base64url(signature)}`
  return `vapid t=${jwt}, k=${config.publicKey}`
}

export interface EncryptOptions {
  /** 16-byte record salt; random per message unless pinned for a test. */
  salt?: Buffer
  /** The server's ephemeral ECDH private key; random unless pinned for a test. */
  serverPrivateKey?: Buffer
}

/**
 * Encrypt a payload for a subscription with the `aes128gcm` content coding.
 * Returns the body bytes to POST, self-describing per RFC 8188 (salt, record
 * size, and the server public key are prepended, so the recipient needs only
 * its own keys to decrypt).
 */
export function encryptPayload(
  subscription: WebPushSubscription,
  payload: string,
  options: EncryptOptions = {},
): Buffer {
  const uaPublic = Buffer.from(subscription.keys.p256dh, "base64url")
  const authSecret = Buffer.from(subscription.keys.auth, "base64url")
  const salt = options.salt ?? randomBytes(16)

  const ecdh = createECDH("prime256v1")
  if (options.serverPrivateKey) ecdh.setPrivateKey(options.serverPrivateKey)
  else ecdh.generateKeys()
  const serverPublic = ecdh.getPublicKey()
  const sharedSecret = ecdh.computeSecret(uaPublic)

  // RFC 8291 §3.3: mix the ECDH secret with the auth secret and both public
  // keys into the input keying material for the content-encryption layer.
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, serverPublic])
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32))

  // RFC 8188: derive the content-encryption key and nonce from the record salt.
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  )
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  )

  // A single record: the plaintext followed by the 0x02 last-record delimiter.
  const record = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])])
  const cipher = createCipheriv("aes-128-gcm", cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()])

  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)
  const header = Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic])
  return Buffer.concat([header, ciphertext])
}

/**
 * Send one alert to one subscription. Resolves with the push service's status;
 * never rejects, so one dead subscription in a fan-out cannot take down the
 * rest. A 404 or 410 sets `gone`, the signal to purge the registration.
 */
export async function sendWebPush(
  config: WebPushConfig,
  subscription: WebPushSubscription,
  alert: WebPushAlert,
): Promise<WebPushResult> {
  let body: Buffer
  let authorization: string
  try {
    body = encryptPayload(subscription, JSON.stringify(alert))
    authorization = vapidAuthHeader(config, subscription.endpoint)
  } catch (error) {
    return { status: 0, gone: false, ...logEncryptFailure(error) }
  }
  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "2419200",
      },
      body,
    })
    return { status: response.status, gone: response.status === 404 || response.status === 410 }
  } catch (error) {
    console.warn(`[web-push] send failed: ${error instanceof Error ? error.message : error}`)
    return { status: 0, gone: false }
  }
}

function logEncryptFailure(error: unknown): Record<string, never> {
  console.warn(`[web-push] encrypt failed: ${error instanceof Error ? error.message : error}`)
  return {}
}
