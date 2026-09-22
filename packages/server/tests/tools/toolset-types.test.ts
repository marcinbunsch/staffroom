import { defineTool } from "@flue/runtime"
import { addPlugin, definePlugin, resetPlugins } from "@staffroom/plugin-core"
import type { Toolset } from "@staffroom/protocol"
import * as v from "valibot"
import { afterEach, describe, expect, it } from "vitest"
import type { AttentionStore } from "../../src/coordinator/attention.ts"
import {
  BUILTIN_TOOLSET_KINDS,
  getToolsetType,
  listToolsetTools,
  toolsetKinds,
} from "../../src/tools/toolset-types.ts"

afterEach(() => resetPlugins())

function toolset(overrides: Partial<Toolset> = {}): Toolset {
  return {
    name: "acme-tools",
    label: "Acme",
    kind: "acme",
    integration: "acme",
    tools: [],
    gatedTools: [],
    toolDescriptions: {},
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  }
}

// The env a driver resolves against. A plugin driver never touches attention, so
// a stub stands in for the non-mcp cases here.
const env = {
  base: { tenantId: "alice", agent: "devops", session: "alice:devops" },
  attention: {} as AttentionStore,
}

describe("the toolset-type registry", () => {
  it("resolves the built-in kinds", () => {
    expect(BUILTIN_TOOLSET_KINDS).toEqual(["mcp", "sandbox"])
    expect(getToolsetType("mcp")).toBeDefined()
    expect(getToolsetType("sandbox")).toBeDefined()
  })

  it("is undefined for an unknown kind", () => {
    expect(getToolsetType("nope")).toBeUndefined()
  })

  it("lists kinds for the UI, built-ins flagged with a bespoke form", () => {
    const builtins = toolsetKinds()
    expect(builtins.find((k) => k.kind === "mcp")).toMatchObject({
      builtinForm: true,
      usesIntegration: true,
    })
    expect(builtins.find((k) => k.kind === "sandbox")).toMatchObject({ builtinForm: true })
    expect(builtins.some((k) => !k.builtinForm)).toBe(false) // no plugins yet
  })

  it("surfaces a plugin kind's metadata for the generic form", () => {
    addPlugin(
      definePlugin({
        id: "notes",
        toolsetTypes: [
          {
            kind: "notes",
            label: "Notes",
            description: "Search notes.",
            usesUrl: true,
            resolve: () => ({}),
          },
        ],
      }),
    )
    const note = toolsetKinds().find((k) => k.kind === "notes")
    expect(note).toMatchObject({
      kind: "notes",
      label: "Notes",
      usesUrl: true,
      usesIntegration: false,
      builtinForm: false,
    })
  })

  it("adapts a plugin kind's tools into compact entries", async () => {
    const echo = defineTool({
      name: "acme_echo",
      description: "Echo a message.",
      input: v.object({ message: v.string() }),
      run: async ({ data }) => `echo: ${(data as { message: string }).message}`,
    })
    addPlugin(
      definePlugin({
        id: "acme",
        toolsetTypes: [{ kind: "acme", resolve: () => ({ tools: [echo] }) }],
      }),
    )

    const type = getToolsetType("acme")
    expect(type).toBeDefined()
    const { entries, sandbox } = type!.resolve(toolset(), env)
    expect(sandbox).toBeUndefined()
    expect(entries?.map((entry) => entry.name)).toEqual(["acme_echo"])
    // The adapted entry validates and runs like any compact tool.
    expect(await entries![0]!.call({ message: "hi" })).toBe("echo: hi")
    const bad = await entries![0]!.call({ message: 42 as unknown as string })
    expect(bad).toContain("Invalid arguments")
  })

  it("enables only the selected subset of a kind's tools, and gates the marked ones", () => {
    const tool = (name: string) =>
      defineTool({ name, description: name, input: v.object({}), run: async () => "" })
    addPlugin(
      definePlugin({
        id: "notes",
        toolsetTypes: [
          { kind: "notes", resolve: () => ({ tools: [tool("a"), tool("b"), tool("c")] }) },
        ],
      }),
    )
    const type = getToolsetType("notes")!
    const { entries } = type.resolve(
      toolset({ kind: "notes", tools: ["a", "c"], gatedTools: ["c"] }),
      env,
    )
    expect(entries?.map((e) => e.name)).toEqual(["a", "c"])
    expect(entries?.find((e) => e.name === "c")?.needsApproval).toBe(true)
    expect(entries?.find((e) => e.name === "a")?.needsApproval).toBe(false)

    // The picker sees every tool the kind offers, not just the enabled ones.
    const meta = listToolsetTools("notes", toolset({ kind: "notes" }), env.base)
    expect(meta.map((m) => m.name)).toEqual(["a", "b", "c"])
  })

  it("passes a plugin kind's sandbox factory through", () => {
    const factory = (() => {}) as never
    addPlugin(
      definePlugin({
        id: "boxy",
        toolsetTypes: [{ kind: "boxy", resolve: () => ({ sandbox: factory }) }],
      }),
    )
    const { sandbox } = getToolsetType("boxy")!.resolve(toolset({ kind: "boxy" }), env)
    expect(sandbox).toBe(factory)
  })
})
