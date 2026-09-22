import { z } from "zod"
import type { ModelCredentialStore } from "../coordinator/model-credentials.ts"

/**
 * Imported ChatGPT/Codex logins.
 *
 * The v1 prototype read `~/.codex/auth.json` off the server's own filesystem
 * and registered one process-global provider from it. That is single-user by
 * construction: one machine, one login, everybody's turns paid for by whoever
 * happened to run `codex login` there.
 *
 * Here the login is **imported** instead — the desktop app reads the file
 * locally, the browser uploads it — and the server stores it as a credential
 * and refreshes it from then on. What survives from the prototype is exactly
 * the part that was never single-user: the token refresh.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"

/** The shape of a `codex login` credential file. */
export const CodexAuthFile = z.object({
  tokens: z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    account_id: z.string().optional(),
  }),
})

export type CodexAuthFile = z.infer<typeof CodexAuthFile>

/**
 * Parse an uploaded `auth.json`.
 *
 * Deliberately strict and deliberately quiet: the message says what was wrong
 * with the *file*, never what was in it, because this text reaches a browser.
 */
export function parseCodexAuthFile(contents: string): CodexAuthFile {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    throw new CodexImportError("that file is not valid JSON")
  }
  const parsed = CodexAuthFile.safeParse(value)
  if (!parsed.success) {
    throw new CodexImportError(
      "that does not look like a Codex auth.json — expected tokens.access_token and tokens.refresh_token",
    )
  }
  return parsed.data
}

export class CodexImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CodexImportError"
  }
}

/** The ChatGPT account id inside a stored Codex secret, if it carries one. */
export function codexAccountId(storedSecret: string): string | undefined {
  try {
    return CodexAuthFile.safeParse(JSON.parse(storedSecret)).data?.tokens.account_id
  } catch {
    return undefined
  }
}

// One refresh in flight per credential. Several agents can render at once, and
// refreshing the same login concurrently would race the write-back.
const pending = new Map<string, Promise<string | undefined>>()

/**
 * The access token for an imported login, refreshing it first if it is about
 * to expire, and writing the refreshed pair back to the credential.
 */
export async function resolveCodexAccessToken(
  credentialId: string,
  storedSecret: string,
  store: ModelCredentialStore,
): Promise<string | undefined> {
  const existing = pending.get(credentialId)
  if (existing) return await existing

  const attempt = refreshIfNeeded(credentialId, storedSecret, store).finally(() =>
    pending.delete(credentialId),
  )
  pending.set(credentialId, attempt)
  return await attempt
}

async function refreshIfNeeded(
  credentialId: string,
  storedSecret: string,
  store: ModelCredentialStore,
): Promise<string | undefined> {
  const parsed = CodexAuthFile.safeParse(JSON.parse(storedSecret))
  if (!parsed.success) return undefined

  const { tokens } = parsed.data
  if (!expiringSoon(tokens.access_token)) return tokens.access_token

  const refreshed = await refresh(tokens.refresh_token)
  store.replaceSecret(
    credentialId,
    JSON.stringify({
      tokens: { ...refreshed, account_id: tokens.account_id },
    }),
  )
  return refreshed.access_token
}

function expiringSoon(token: string): boolean {
  try {
    const payload = token.split(".")[1]
    const { exp } = JSON.parse(Buffer.from(payload ?? "", "base64url").toString()) as {
      exp?: unknown
    }
    return typeof exp !== "number" || exp * 1000 - Date.now() < 60_000
  } catch {
    return true
  }
}

async function refresh(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
}> {
  const response = await fetch("https://auth.openai.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `OpenAI Codex token refresh failed (${response.status}). Re-import the login from Settings.`,
    )
  }
  const value: unknown = await response.json()
  const parsed = z
    .object({ access_token: z.string().min(1), refresh_token: z.string().min(1) })
    .safeParse(value)
  if (!parsed.success) throw new Error("OpenAI Codex token refresh returned an invalid credential.")
  return parsed.data
}
