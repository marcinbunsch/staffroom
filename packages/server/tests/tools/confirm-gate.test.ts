import { describe, expect, it } from "vitest"
import { AttentionStore } from "../../src/coordinator/attention.ts"
import { gatingAttach } from "../../src/tools/confirm-gate.ts"
import type { ToolContext, ToolDescriptor } from "../../src/tools/registry.ts"
import { migratedDatabase } from "../migrated-database.ts"

/** A minimal Flue-tool-shaped object the gate can wrap. */
function fakeTool(name: string, run: (arg: { data: unknown }) => Promise<string> | string) {
  return { name, description: `the ${name} tool`, input: {}, run }
}

const context: ToolContext = {
  tenantId: "alice",
  agent: "devops",
  session: "alice:devops__job-1",
  jobId: 1,
  credential: {},
}

async function setup() {
  const attention = new AttentionStore(await migratedDatabase())
  let realRuns = 0
  const tool = fakeTool("send_message", async () => {
    realRuns += 1
    return "sent!"
  })
  // Capture what the gate mounts, and invoke it like the model would.
  let mounted: { run: (arg: { data: unknown }) => Promise<string> } | undefined
  const attach = gatingAttach(attention, (t) => {
    mounted = t as typeof mounted
  })
  const descriptor: ToolDescriptor = {
    name: "send_message",
    description: "",
    provisioning: "none",
    gated: true,
    build() {},
  }
  attach(descriptor, context, tool)
  const call = (data: unknown) => mounted!.run({ data })
  return { attention, call, realRuns: () => realRuns }
}

describe("the confirm-gate", () => {
  it("mounts a non-gated tool unchanged", async () => {
    const attention = new AttentionStore(await migratedDatabase())
    let mounted: unknown
    const attach = gatingAttach(attention, (t) => {
      mounted = t
    })
    const tool = fakeTool("read_thing", async () => "ok")
    attach(
      { name: "read_thing", description: "", provisioning: "none", gated: false, build() {} },
      context,
      tool,
    )
    // Same object, not a wrapper.
    expect(mounted).toBe(tool)
  })

  /**
   * The suspend: a first call does not act. It raises an approval and returns a
   * message. The real implementation never runs.
   */
  it("suspends the first call instead of acting", async () => {
    const { attention, call, realRuns } = await setup()
    const result = await call({ to: "x", body: "hi" })

    expect(result).toContain("needs operator approval")
    expect(realRuns()).toBe(0)
    expect(attention.open("alice")).toHaveLength(1)
  })

  it("does not raise a second request while one is pending", async () => {
    const { attention, call } = await setup()
    await call({ to: "x", body: "hi" })
    const second = await call({ to: "x", body: "hi" })

    expect(second).toContain("Still awaiting")
    expect(attention.open("alice")).toHaveLength(1)
  })

  /**
   * The resume: once approved, the same call goes through and the real
   * implementation runs — exactly once.
   */
  it("lets the approved call through, once", async () => {
    const { attention, call, realRuns } = await setup()
    await call({ to: "x", body: "hi" })
    const approval = attention.open("alice")[0]!
    attention.answer("alice", approval.approvalId!, "approved")

    expect(await call({ to: "x", body: "hi" })).toBe("sent!")
    expect(realRuns()).toBe(1)

    // A second identical call is gated again — an approval is not forever.
    const third = await call({ to: "x", body: "hi" })
    expect(third).toContain("needs operator approval")
    expect(realRuns()).toBe(1)
  })

  /** A different argument is a different call, and gets its own gate. */
  it("gates each distinct argument separately", async () => {
    const { attention, call, realRuns } = await setup()
    await call({ to: "x", body: "hi" })
    const approval = attention.open("alice")[0]!
    attention.answer("alice", approval.approvalId!, "approved")

    // Approved "hi"; now try "different" — must be gated, not waved through.
    const result = await call({ to: "x", body: "different" })
    expect(result).toContain("needs operator approval")
    expect(realRuns()).toBe(0)
  })

  it("never runs a denied call", async () => {
    const { attention, call, realRuns } = await setup()
    await call({ to: "x", body: "hi" })
    const approval = attention.open("alice")[0]!
    attention.answer("alice", approval.approvalId!, "denied", "no")

    const result = await call({ to: "x", body: "hi" })
    // Denied: not consumed, so it raises a fresh gate rather than acting.
    expect(result).toContain("needs operator approval")
    expect(realRuns()).toBe(0)
  })
})
