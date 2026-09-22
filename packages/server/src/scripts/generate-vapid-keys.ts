/**
 * Generate a VAPID keypair for Web Push, once.
 *
 *   pnpm --filter @staffroom/server vapid
 *
 * Web Push (unlike APNs) needs no Apple account — just a P-256 keypair you
 * generate yourself and keep. This prints the two environment variables the
 * server reads; set them on the deployment and restart. Keep the private key
 * secret and stable: regenerating it invalidates every existing browser
 * subscription, silently, so no push would arrive until each client re-subscribes.
 *
 * The public key is also what the browser passes as `applicationServerKey` when
 * it subscribes; the client fetches it from `/api/push/vapid-public-key`, so
 * there is nothing to copy into the frontend by hand.
 */
import { generateVapidKeys } from "../coordinator/web-push.ts"

const { publicKey, privateKey } = generateVapidKeys()

console.log("VAPID keypair generated. Set these on the server and restart:\n")
console.log(`STAFFROOM_VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`STAFFROOM_VAPID_PRIVATE_KEY=${privateKey}`)
console.log(
  "\nOptional: STAFFROOM_VAPID_SUBJECT=mailto:you@example.com (defaults to the server URL)",
)
