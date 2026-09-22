import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchCodexUsage } from "../../src/providers/codex-usage.ts"

afterEach(() => vi.unstubAllGlobals())

/** A realistic slice of the undocumented `/backend-api/wham/usage` payload. */
const PAYLOAD = {
  plan_type: "plus",
  rate_limit: {
    primary_window: {
      used_percent: 42.7,
      limit_window_seconds: 5 * 3600,
      reset_at: 1_800_000_000,
    },
    secondary_window: {
      used_percent: 8,
      limit_window_seconds: 7 * 24 * 3600,
      reset_after_seconds: 3600,
    },
  },
}

describe("fetchCodexUsage", () => {
  it("normalizes the wham/usage payload and sends auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(PAYLOAD))
    vi.stubGlobal("fetch", fetchMock)

    const usage = await fetchCodexUsage("tok-123", "acct-9")
    expect(usage).toMatchObject({
      planType: "plus",
      primary: { usedPercent: 42.7, windowMinutes: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 8, windowMinutes: 10_080 },
    })
    // reset_after_seconds is turned into an absolute time near now + 3600s.
    const expected = Math.floor(Date.now() / 1000) + 3600
    expect(Math.abs((usage?.secondary?.resetsAt ?? 0) - expected)).toBeLessThan(5)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://chatgpt.com/backend-api/wham/usage")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer tok-123")
    expect(headers["ChatGPT-Account-Id"]).toBe("acct-9")
  })

  it("clamps out-of-range percentages and tolerates missing windows", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ rate_limit: { primary_window: { used_percent: 140 } } }),
        ),
    )
    const usage = await fetchCodexUsage("tok")
    expect(usage).toMatchObject({
      planType: null,
      primary: { usedPercent: 100, windowMinutes: null, resetsAt: null },
      secondary: null,
    })
  })

  it("returns undefined when the endpoint refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 401 })))
    expect(await fetchCodexUsage("tok")).toBeUndefined()
  })

  it("returns undefined when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))
    expect(await fetchCodexUsage("tok")).toBeUndefined()
  })
})
