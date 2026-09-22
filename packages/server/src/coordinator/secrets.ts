import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { resolveEncryptionKey } from "../core/config.ts"

/**
 * Encryption at rest for stored credentials.
 *
 * One `staffroom.db` holds several colleagues' API keys and OAuth tokens, so a
 * copy of that file is a copy of everyone's credentials. AES-256-GCM per
 * record, with a random IV each time and the auth tag kept alongside — so a
 * tampered ciphertext fails to decrypt rather than decrypting to something
 * else.
 *
 * Arriving here rather than with the tool catalog (M6) because model-provider
 * credentials are the first secrets the system stores, and a secret written in
 * the clear now is one that stays in the clear in every existing database.
 */

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12 // GCM's standard nonce length
const VERSION = "v1"

/**
 * `v1.<iv>.<tag>.<ciphertext>`, all base64url. Versioned from the first write:
 * changing algorithm later needs a way to tell old records from new ones, and
 * retrofitting that costs a migration over unreadable data.
 */
export function encryptSecret(plaintext: string, key = resolveEncryptionKey()): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, deriveKey(key), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptSecret(encoded: string, key = resolveEncryptionKey()): string {
  const [version, iv, tag, ciphertext] = encoded.split(".")
  // AES-GCM legitimately encodes an empty plaintext as an empty ciphertext.
  // Local model servers may omit their optional API key, so accept that fourth
  // component when it is empty while still requiring it to be present.
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new SecretDecryptionError("stored secret is not in the expected format")
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(key), Buffer.from(iv, "base64url"))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    // The two causes are a wrong key and a tampered record, and we cannot tell
    // them apart — GCM is doing its job in both cases.
    throw new SecretDecryptionError(
      "stored secret could not be decrypted: the encryption key has changed, or the record was altered",
    )
  }
}

/** Thrown when a stored secret cannot be read back. Never carries the ciphertext. */
export class SecretDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretDecryptionError"
  }
}

// The configured key is a passphrase of any length; AES-256 needs exactly 32
// bytes. A plain SHA-256 rather than a password KDF is deliberate: the
// generated key is already 32 random bytes, so there is no low-entropy secret
// here for a slow hash to protect.
function deriveKey(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest()
}
