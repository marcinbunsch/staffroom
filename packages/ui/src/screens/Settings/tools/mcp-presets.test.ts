import { describe, expect, it } from "vitest"
import type { IntegrationRow } from "../../../lib/api.ts"
import { MCP_PRESETS, presetGroups, presetValues } from "./mcp-presets.ts"

const integration = (name: string, type: string): IntegrationRow =>
  ({ name, type, label: name, kind: "oauth" }) as IntegrationRow

describe("mcp presets", () => {
  it("has a unique slug and a valid URL per preset", () => {
    const slugs = MCP_PRESETS.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const preset of MCP_PRESETS) {
      expect(preset.slug).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(() => new URL(preset.url)).not.toThrow()
    }
  })

  it("groups presets in first-appearance order, each group listed once", () => {
    const groups = presetGroups().map((g) => g.group)
    expect(new Set(groups).size).toBe(groups.length)
    expect(groups.at(-1)).toBe("Apps")
    // Every preset lands in exactly one group, in catalogue order.
    expect(
      presetGroups()
        .flatMap((g) => g.presets.map((p) => p.slug))
        .sort(),
    ).toEqual(MCP_PRESETS.map((p) => p.slug).sort())
  })

  it("picks the first integration of the preset's type", () => {
    const logging = MCP_PRESETS.find((p) => p.slug === "cloud-logging")!
    const values = presetValues(logging, [
      integration("slack-app", "slack"),
      integration("gcp-prod", "gcp"),
      integration("gcp-staging", "gcp"),
    ])
    expect(values).toEqual({
      label: "Cloud Logging",
      name: "cloud-logging",
      url: "https://logging.googleapis.com/mcp",
      integration: "gcp-prod",
    })
  })

  it("leaves the integration empty when none of that type is configured", () => {
    const slack = MCP_PRESETS.find((p) => p.slug === "slack")!
    expect(presetValues(slack, [integration("gcp-prod", "gcp")]).integration).toBe("")
  })
})
