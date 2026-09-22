import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchLmStudioModelCatalog, lmStudioProvider } from "../../src/providers/lm-studio.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("LM Studio provider", () => {
  it("uses LM Studio's loaded context window for concrete models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [
            {
              id: "qwen/qwen3.8-27b",
              state: "loaded",
              loaded_context_length: 262_144,
            },
          ],
        }),
      ),
    )

    const models = await fetchLmStudioModelCatalog("http://localhost:1234/v1")
    const provider = lmStudioProvider({
      id: "lm-studio-alice",
      name: "LM Studio",
      baseUrl: "http://localhost:1234/v1",
      auth: { apiKey: { name: "local", resolve: async () => undefined } },
      models,
    })
    const model = provider.getModels().find((candidate) => candidate.id === "qwen/qwen3.8-27b")
    const shorthand = provider.getModels().find((candidate) => candidate.id === "qwen3.8-27b")

    expect(model?.contextWindow).toBe(262_144)
    expect(model?.maxTokens).toBe(8_192)
    expect(model?.provider).toBe("lm-studio-alice")
    expect(model?.baseUrl).toBe("http://localhost:1234/v1")
    expect(shorthand).toMatchObject({
      contextWindow: 262_144,
      maxTokens: 8_192,
      provider: "lm-studio-alice",
    })
  })
})
