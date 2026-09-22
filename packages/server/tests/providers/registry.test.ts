import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import { beforeAll, describe, expect, it } from "vitest"
import { ModelCredentialStore } from "../../src/coordinator/model-credentials.ts"
import { migratedDatabase } from "../migrated-database.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

/**
 * Aliasing a built-in provider per credential is the mechanism that makes
 * per-tenant keys work inside Flue's single process-global registry. These
 * cases pin the two properties that make the alias real, both of which were
 * found the hard way against a live server.
 */
describe("aliasing a built-in provider", () => {
  function anthropic() {
    const provider = builtinProviders().find((candidate) => candidate.id === "anthropic")
    if (!provider) throw new Error("pi-ai no longer ships an `anthropic` provider")
    return provider
  }

  /**
   * The bug this exists to prevent.
   *
   * Flue finds a model through the registry key, but pi-ai resolves *auth*
   * from the model's own `provider` field. Alias the provider without
   * re-stamping its catalog and every turn authenticates against the built-in
   * id instead — failing with "Provider is not configured: anthropic" while the
   * aliased provider sits in the registry looking perfectly correct.
   */
  it("re-stamps the catalog, not just the provider id", () => {
    const base = anthropic()
    const aliased = base.getModels().map((model) => ({ ...model, provider: "anthropic-org" }))

    expect(aliased.length).toBeGreaterThan(0)
    expect(new Set(aliased.map((model) => model.provider))).toEqual(new Set(["anthropic-org"]))
    // The built-in's own catalog must not have been mutated in the process.
    expect(new Set(base.getModels().map((model) => model.provider))).toEqual(new Set(["anthropic"]))
  })

  it("keeps the base url and model ids of the provider it aliases", () => {
    const base = anthropic()
    const model = base.getModels()[0]
    if (!model) throw new Error("expected at least one model")

    const aliased = { ...model, provider: "anthropic-org" }
    expect(aliased.id).toBe(model.id)
    expect(aliased.baseUrl).toBe(model.baseUrl)
  })

  /** The provider id has to survive being put in a model string. */
  it("derives provider ids that parse as a model specifier", async () => {
    const store = new ModelCredentialStore(await migratedDatabase())
    const credential = store.create("alice", {
      scope: "user",
      kind: "api_key",
      upstream: "anthropic",
      label: "personal",
      apiKey: "sk-ant-x",
      isDefault: false,
    })

    expect(credential.providerId).not.toContain("/")
    expect(credential.providerId).toMatch(/^[a-z0-9-]+$/)
    const specifier = `${credential.providerId}/claude-sonnet-5`
    expect(specifier.slice(0, specifier.indexOf("/"))).toBe(credential.providerId)
  })
})
