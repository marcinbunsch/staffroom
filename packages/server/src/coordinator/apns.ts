import { createPrivateKey, createSign } from "node:crypto"
import { connect, type ClientHttp2Session, constants } from "node:http2"
import type { ApnsConfig } from "../core/config.ts"

/**
 * A minimal APNs client — provider-token auth over HTTP/2, no dependency.
 *
 * Apple's push API is an HTTP/2 POST per device, authorized by a short-lived
 * ES256 JWT signed with the account's `.p8` key. Both halves are Node built-ins
 * (`crypto` signs the token, `http2` sends the request), so this needs nothing
 * from npm. It deliberately does the smallest correct thing: sign, connect,
 * post, read the status. Retries, priorities, and collapse-ids are not modelled
 * until a real notification needs them.
 */

const SANDBOX_HOST = "api.sandbox.push.apple.com"
const PRODUCTION_HOST = "api.push.apple.com"

/** What a device push carries. Kept flat; the caller builds the `aps` payload. */
export interface ApnsAlert {
  title: string
  body: string
  /** The iOS home-screen badge number. `0` clears it. */
  badge?: number
  /** Groups notifications in the tray and routes the tap (a chat/agent id). */
  threadId?: string
  /** Custom keys delivered alongside `aps`, for the tap handler to deep-link. */
  data?: Record<string, string>
}

export interface ApnsResult {
  token: string
  status: number
  reason?: string
  /** The token is dead (uninstalled or invalid) — the caller should purge it. */
  gone: boolean
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

/**
 * The provider JWT. Apple accepts one for up to an hour and rate-limits fresh
 * tokens, so we sign at most once every ~50 minutes and reuse it across sends.
 * Keyed by key-id so a credential rotation invalidates the cache.
 */
let cachedJwt: { keyId: string; issuedAt: number; token: string } | undefined
const JWT_TTL_MS = 50 * 60 * 1000

export function signProviderJwt(config: ApnsConfig, now: number = Date.now()): string {
  if (cachedJwt && cachedJwt.keyId === config.keyId && now - cachedJwt.issuedAt < JWT_TTL_MS) {
    return cachedJwt.token
  }
  const issuedAt = Math.floor(now / 1000)
  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }))
  const payload = base64url(JSON.stringify({ iss: config.teamId, iat: issuedAt }))
  const signingInput = `${header}.${payload}`
  // The .p8 is a PKCS#8 EC key; ES256 wants the raw r||s pair, not DER — which
  // is what `ieee-p1363` produces.
  const signature = createSign("sha256")
    .update(signingInput)
    .sign({ key: createPrivateKey(config.key), dsaEncoding: "ieee-p1363" })
  const token = `${signingInput}.${base64url(signature)}`
  cachedJwt = { keyId: config.keyId, issuedAt: now, token }
  return token
}

/** Drop the cached JWT — for tests, and after a credential change. */
export function resetProviderJwt(): void {
  cachedJwt = undefined
}

let session: { host: string; http2: ClientHttp2Session } | undefined

function sessionFor(host: string): ClientHttp2Session {
  if (session && session.host === host && !session.http2.closed && !session.http2.destroyed) {
    return session.http2
  }
  const http2 = connect(`https://${host}`)
  // A connection error must not crash the process; the next send reconnects.
  http2.on("error", (error) => console.warn(`[apns] session error: ${error.message}`))
  session = { host, http2 }
  return http2
}

function apsPayload(alert: ApnsAlert): string {
  const aps: Record<string, unknown> = {
    alert: { title: alert.title, body: alert.body },
    sound: "default",
  }
  if (alert.badge !== undefined) aps.badge = alert.badge
  if (alert.threadId !== undefined) aps["thread-id"] = alert.threadId
  return JSON.stringify({ aps, ...alert.data })
}

/**
 * Send one alert to one device. Resolves with the APNs status; never rejects,
 * so one dead token in a fan-out cannot take down the rest. A 410 (or a 400
 * `BadDeviceToken`) sets `gone`, the signal to purge the registration.
 */
export function sendApns(config: ApnsConfig, token: string, alert: ApnsAlert): Promise<ApnsResult> {
  const host = config.production ? PRODUCTION_HOST : SANDBOX_HOST
  const body = apsPayload(alert)
  return new Promise((resolve) => {
    let http2: ClientHttp2Session
    try {
      http2 = sessionFor(host)
    } catch (error) {
      resolve({ token, status: 0, reason: String(error), gone: false })
      return
    }
    const request = http2.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      [constants.HTTP2_HEADER_AUTHORIZATION]: `bearer ${signProviderJwt(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
    })
    let status = 0
    let responseBody = ""
    request.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0)
    })
    request.setEncoding("utf8")
    request.on("data", (chunk) => {
      responseBody += chunk
    })
    request.on("error", (error) => {
      resolve({ token, status: 0, reason: error.message, gone: false })
    })
    request.on("end", () => {
      const reason = parseReason(responseBody)
      resolve({ token, status, reason, gone: isGone(status, reason) })
    })
    request.end(body)
  })
}

function parseReason(body: string): string | undefined {
  if (!body) return undefined
  try {
    const reason = (JSON.parse(body) as { reason?: string }).reason
    return typeof reason === "string" ? reason : undefined
  } catch {
    return undefined
  }
}

function isGone(status: number, reason?: string): boolean {
  // 410 Unregistered is the canonical "device is gone"; a 400 BadDeviceToken is
  // a token that was never (or is no longer) valid. Both mean: stop sending.
  return status === 410 || reason === "Unregistered" || reason === "BadDeviceToken"
}

/** Close the shared HTTP/2 session — for tests and clean shutdown. */
export function closeApnsSession(): void {
  session?.http2.close()
  session = undefined
}
