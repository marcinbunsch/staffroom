import { toJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"
import { beforeAll, describe, expect, it } from "vitest"
import { AttentionStore } from "../../src/coordinator/attention.ts"
import { invokeGated } from "../../src/tools/confirm-gate.ts"
import {
  type CompactEntry,
  type CompactTools,
  callTool,
  describeTool,
} from "../../src/tools/compact-tools.ts"
import { migratedDatabase } from "../migrated-database.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

/** Build the name→entry map the meta-tools dispatch over. */
function mapOf(entries: CompactEntry[]): CompactTools {
  return new Map(entries.map((entry) => [entry.name, entry]))
}

/** A local-shaped entry: validates against a valibot schema, then runs. */
function localEntry(
  name: string,
  options: {
    input?: v.GenericSchema
    run?: (args: Record<string, unknown>) => string | Promise<string>
    needsApproval?: boolean
  } = {},
): CompactEntry {
  return {
    name,
    description: `does ${name}`,
    needsApproval: options.needsApproval ?? false,
    describe: () =>
      options.input ? toJsonSchema(options.input) : { type: "object", properties: {} },
    call: (args) => {
      if (options.input) {
        const result = v.safeParse(options.input, args)
        if (!result.success) {
          return `Invalid arguments for ${name}: ${result.issues[0]?.message}. Call describe_tool("${name}").`
        }
      }
      return options.run ? options.run(args) : `ran ${name}`
    },
  }
}

describe("the compact tool gateway", () => {
  it("describe_tool returns the entry's JSON-schema inputs", async () => {
    const map = mapOf([
      localEntry("firecrawl_scrape", {
        input: v.object({ url: v.string(), depth: v.optional(v.number()) }),
      }),
    ])
    const described = JSON.parse(await describeTool(map, "firecrawl_scrape"))
    expect(described.tool).toBe("firecrawl_scrape")
    expect(described.input.type).toBe("object")
    expect(described.input.properties.url).toMatchObject({ type: "string" })
    expect(described.input.required).toEqual(["url"]) // depth is optional
  })

  it("describe_tool on an unknown name lists what the agent does have", async () => {
    const map = mapOf([localEntry("gmail_read")])
    expect(await describeTool(map, "nope")).toContain("gmail_read")
  })

  it("call_tool validates arguments against the entry's schema", async () => {
    const map = mapOf([localEntry("firecrawl_scrape", { input: v.object({ url: v.string() }) })])
    const bad = await callTool(map, "firecrawl_scrape", { url: 42 as unknown as string })
    expect(bad).toContain("Invalid arguments")
    expect(bad).toContain("describe_tool")
  })

  it("call_tool runs the entry with its arguments", async () => {
    const map = mapOf([
      localEntry("firecrawl_scrape", {
        input: v.object({ url: v.string() }),
        run: (args) => `scraped ${args.url}`,
      }),
    ])
    expect(await callTool(map, "firecrawl_scrape", { url: "https://x.test" })).toBe(
      "scraped https://x.test",
    )
  })

  it("call_tool on an unknown name does not throw, it explains", async () => {
    const map = mapOf([localEntry("gmail_read")])
    expect(await callTool(map, "typo", {})).toContain("gmail_read")
  })

  it("call_tool turns a thrown error into text rather than failing the turn", async () => {
    const map = mapOf([
      localEntry("flaky", {
        run: () => {
          throw new Error("boom")
        },
      }),
    ])
    const result = await callTool(map, "flaky", {})
    expect(result).toContain("flaky failed")
    expect(result).toContain("boom")
  })

  it("a gated local entry suspends for approval instead of running", async () => {
    const attention = new AttentionStore(await migratedDatabase())
    let ran = false
    const context = {
      tenantId: "alice",
      agent: "devops",
      session: "alice:devops",
      credential: {},
    }
    // A gated entry that routes through the confirm-gate — modelled directly so
    // the dispatch layer is exercised without a Flue frame.
    const entry: CompactEntry = {
      name: "send_email",
      description: "send",
      needsApproval: true,
      describe: () => ({ type: "object" }),
      call: (args) =>
        invokeGated(
          true,
          context,
          "send_email",
          args,
          () => {
            ran = true
            return "sent"
          },
          attention,
        ),
    }
    const map = mapOf([entry])

    const first = await callTool(map, "send_email", { to: "ops@x.test" })
    expect(ran).toBe(false)
    expect(first).toContain("needs operator approval")

    const again = await callTool(map, "send_email", { to: "ops@x.test" })
    expect(ran).toBe(false)
    expect(again).toContain("Still awaiting operator approval")

    const open = attention
      .open("alice")
      .some((item) => item.session === "alice:devops" && item.kind === "approval")
    expect(open).toBe(true)
  })
})
