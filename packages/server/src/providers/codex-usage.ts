import type { CodexUsage, CodexUsageWindow } from "@staffroom/protocol"

/**
 * A Codex login's live usage against its plan limits.
 *
 * Read from the same undocumented ChatGPT endpoint the official Codex client
 * uses (`/backend-api/wham/usage`). It is not a public API and its shape can
 * change without notice, so parsing is entirely defensive: a missing or oddly
 * typed field yields `null`, never a throw. Unlike the token refresh in
 * `openai-codex.ts`, this talks to the ChatGPT backend rather than the OAuth
 * endpoint — the model call itself lives in Flue, so this is our only window
 * onto how much of the plan is spent.
 */

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

/**
 * Fetch the usage snapshot for a resolved access token. Returns `undefined`
 * when the endpoint refuses or is unreachable — the gauge simply hides rather
 * than surfacing an error over a background poll.
 */
export async function fetchCodexUsage(
  accessToken: string,
  accountId?: string,
): Promise<CodexUsage | undefined> {
  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
      },
    })
  } catch {
    return undefined
  }
  if (!response.ok) return undefined
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return undefined
  }
  return normalize(payload)
}

function normalize(payload: unknown): CodexUsage {
  const root = asObject(payload)
  const rateLimit = asObject(root?.rate_limit)
  return {
    planType: asString(root?.plan_type),
    primary: normalizeWindow(rateLimit?.primary_window),
    secondary: normalizeWindow(rateLimit?.secondary_window),
    capturedAt: Date.now(),
  }
}

function normalizeWindow(value: unknown): CodexUsageWindow | null {
  const obj = asObject(value)
  if (!obj) return null
  const usedPercent = asNumber(obj.used_percent)
  if (usedPercent === null) return null
  const windowSeconds = asNumber(obj.limit_window_seconds)
  const resetAt = asNumber(obj.reset_at)
  const resetAfter = asNumber(obj.reset_after_seconds)
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    windowMinutes: windowSeconds !== null ? Math.round(windowSeconds / 60) : null,
    // Prefer an absolute reset time; fall back to now + the relative one.
    resetsAt: resetAt ?? (resetAfter !== null ? Math.floor(Date.now() / 1000) + resetAfter : null),
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
