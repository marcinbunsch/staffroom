import { addPlugin, definePlugin, resetPlugins } from "@staffroom/plugin-core"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { getIntegrationType, integrationTypes } from "../src/core/integrations.ts"
import { assertPluginsCompatible } from "../src/core/plugins.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

afterEach(() => resetPlugins())

const provider = {
  type: "acme",
  kind: "token" as const,
  label: "Acme",
  description: "An example provider.",
  configFields: [],
  defaultScopes: [],
  unlocks: ["Acme"],
}

describe("plugin integration types", () => {
  it("merge into the type registry and picker", () => {
    addPlugin(definePlugin({ id: "acme", integrationTypes: [provider] }))
    expect(getIntegrationType("acme")).toMatchObject({ type: "acme", label: "Acme" })
    expect(integrationTypes().map((type) => type.type)).toContain("acme")
    // Built-ins still resolve.
    expect(getIntegrationType("google")).toBeDefined()
  })
})

describe("collision guards", () => {
  it("rejects a duplicate plugin id at install", () => {
    addPlugin(definePlugin({ id: "example", integrationTypes: [provider] }))
    expect(() => addPlugin(definePlugin({ id: "example" }))).toThrow(/already installed/)
  })

  it("rejects an integration-type clash across plugins at install", () => {
    addPlugin(definePlugin({ id: "one", integrationTypes: [provider] }))
    expect(() => addPlugin(definePlugin({ id: "two", integrationTypes: [provider] }))).toThrow(
      /collides/,
    )
  })

  it("rejects a toolset-kind clash across plugins at install", () => {
    addPlugin(definePlugin({ id: "one", toolsetTypes: [{ kind: "acme", resolve: () => ({}) }] }))
    expect(() =>
      addPlugin(definePlugin({ id: "two", toolsetTypes: [{ kind: "acme", resolve: () => ({}) }] })),
    ).toThrow(/collides/)
  })

  it("fails the boot when a plugin integration type shadows a built-in", () => {
    const clash = {
      type: "google",
      kind: "oauth" as const,
      label: "Fake",
      description: "",
      configFields: [],
      defaultScopes: [],
      unlocks: [],
    }
    addPlugin(definePlugin({ id: "bad", integrationTypes: [clash] }))
    expect(() => assertPluginsCompatible()).toThrow(/built-in type/)
  })

  it("fails the boot when a plugin toolset kind shadows a built-in", () => {
    addPlugin(definePlugin({ id: "bad", toolsetTypes: [{ kind: "mcp", resolve: () => ({}) }] }))
    expect(() => assertPluginsCompatible()).toThrow(/built-in kind/)
  })

  it("passes the boot for a clean plugin", () => {
    addPlugin(definePlugin({ id: "example", integrationTypes: [provider] }))
    expect(() => assertPluginsCompatible()).not.toThrow()
  })
})
