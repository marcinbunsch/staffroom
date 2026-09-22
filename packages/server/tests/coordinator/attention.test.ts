import { describe, expect, it } from "vitest"
import {
  AttentionStore,
  type RaiseApprovalInput,
  hashArguments,
} from "../../src/coordinator/attention.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

async function makeStore(): Promise<AttentionStore> {
  return new AttentionStore(await migratedDatabase())
}

function raiseInput(
  tenantId: string,
  overrides: Partial<RaiseApprovalInput> = {},
): RaiseApprovalInput {
  return {
    tenantId,
    jobId: 1,
    session: `${tenantId}:devops__job-1`,
    agent: "devops",
    tool: "send_message",
    argumentsHash: hashArguments({ to: "x", body: "y" }),
    summary: "send_message to x",
    ...overrides,
  }
}

defineTenantIsolationTests("attention", async () => {
  const store = await makeStore()
  return {
    create: (tenantId) => store.raise(raiseInput(tenantId)).id,
    read: (tenantId, id) => store.getApproval(tenantId, id),
    // The isolation list reads the open attention board.
    list: (tenantId) => store.open(tenantId),
  }
})

describe("hashArguments", () => {
  it("is stable for equal input and different for different", () => {
    expect(hashArguments({ a: 1 })).toBe(hashArguments({ a: 1 }))
    expect(hashArguments({ a: 1 })).not.toBe(hashArguments({ a: 2 }))
  })
})

describe("approvals", () => {
  it("raises a pending approval and an open attention item together", async () => {
    const store = await makeStore()
    const approval = store.raise(raiseInput("alice"))

    expect(approval.state).toBe("pending")
    const items = store.open("alice")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: "approval", approvalId: approval.id })
  })

  it("does not consume anything while pending", async () => {
    const store = await makeStore()
    const input = raiseInput("alice")
    store.raise(input)

    expect(store.consumeApproval(input.session, input.tool, input.argumentsHash)).toBe(false)
    expect(store.pendingFor(input.session, input.tool, input.argumentsHash)).toBe(true)
  })

  it("consumes an approved approval exactly once — one-shot", async () => {
    const store = await makeStore()
    const input = raiseInput("alice")
    const approval = store.raise(input)
    store.answer("alice", approval.id, "approved")

    expect(store.consumeApproval(input.session, input.tool, input.argumentsHash)).toBe(true)
    // A second identical call finds nothing: approve forever is prevented.
    expect(store.consumeApproval(input.session, input.tool, input.argumentsHash)).toBe(false)
  })

  it("resolves the attention item when answered", async () => {
    const store = await makeStore()
    const approval = store.raise(raiseInput("alice"))
    store.answer("alice", approval.id, "approved")

    expect(store.open("alice")).toHaveLength(0)
  })

  it("records a denial with its reason", async () => {
    const store = await makeStore()
    const approval = store.raise(raiseInput("alice"))
    const denied = store.answer("alice", approval.id, "denied", "recipient looks wrong")

    expect(denied?.state).toBe("denied")
    expect(denied?.reason).toBe("recipient looks wrong")
    // A denied approval never lets a call through.
    const input = raiseInput("alice")
    expect(store.consumeApproval(input.session, input.tool, input.argumentsHash)).toBe(false)
  })

  it("will not answer another tenant's approval", async () => {
    const store = await makeStore()
    const approval = store.raise(raiseInput("alice"))
    expect(store.answer("bob", approval.id, "approved")).toBeUndefined()
  })

  it("will not answer an already-answered approval", async () => {
    const store = await makeStore()
    const approval = store.raise(raiseInput("alice"))
    store.answer("alice", approval.id, "approved")
    expect(store.answer("alice", approval.id, "denied")).toBeUndefined()
  })

  describe("cancellation on job death", () => {
    it("cancels a job's pending approvals so a late approval cannot wake it", async () => {
      const store = await makeStore()
      const input = raiseInput("alice", { jobId: 7, session: "alice:devops__job-7" })
      store.raise(input)

      expect(store.cancelForJob("alice", 7)).toBe(1)
      // The approval is cancelled; answering it now does nothing, and no call
      // can be consumed.
      expect(store.consumeApproval(input.session, input.tool, input.argumentsHash)).toBe(false)
      expect(store.open("alice")).toHaveLength(0)
    })

    it("leaves another job's approvals alone", async () => {
      const store = await makeStore()
      store.raise(raiseInput("alice", { jobId: 7, session: "alice:devops__job-7" }))
      store.raise(raiseInput("alice", { jobId: 8, session: "alice:devops__job-8" }))

      expect(store.cancelForJob("alice", 7)).toBe(1)
      expect(store.open("alice")).toHaveLength(1)
    })
  })
})

describe("requests (attention_request)", () => {
  function requestInput(tenantId: string, overrides: Record<string, unknown> = {}) {
    return {
      tenantId,
      agent: "devops",
      session: `${tenantId}:devops`,
      jobId: null,
      kind: "failure" as const,
      title: "Docker access denied",
      detail: "docker ps returned permission denied",
      ...overrides,
    }
  }

  it("raises an open request item with its kind and no approval", async () => {
    const store = await makeStore()
    const item = store.raiseRequest(requestInput("alice"))

    expect(item).toMatchObject({ kind: "failure", approvalId: null, status: "open" })
    expect(store.open("alice")).toHaveLength(1)
  })

  it("dedupes an identical open request on (session, kind, title)", async () => {
    const store = await makeStore()
    const first = store.raiseRequest(requestInput("alice"))
    const second = store.raiseRequest(requestInput("alice"))

    expect(second.id).toBe(first.id)
    expect(store.open("alice")).toHaveLength(1)
    // A different kind with the same title is a distinct request.
    store.raiseRequest(requestInput("alice", { kind: "question" }))
    expect(store.open("alice")).toHaveLength(2)
  })

  it("resolves a request and clears it from the board", async () => {
    const store = await makeStore()
    const item = store.raiseRequest(requestInput("alice"))

    const resolved = store.resolveRequest("alice", item.id)
    expect(resolved?.status).toBe("resolved")
    expect(resolved?.session).toBe("alice:devops")
    expect(store.open("alice")).toHaveLength(0)
  })

  it("dismisses a request and clears it from the board", async () => {
    const store = await makeStore()
    const item = store.raiseRequest(requestInput("alice"))

    expect(store.dismissRequest("alice", item.id)?.status).toBe("dismissed")
    expect(store.open("alice")).toHaveLength(0)
  })

  it("will not close another tenant's request, or one already answered", async () => {
    const store = await makeStore()
    const item = store.raiseRequest(requestInput("alice"))

    expect(store.resolveRequest("mallory", item.id)).toBeUndefined()
    expect(store.resolveRequest("alice", item.id)?.status).toBe("resolved")
    expect(store.resolveRequest("alice", item.id)).toBeUndefined()
    expect(store.dismissRequest("alice", item.id)).toBeUndefined()
  })

  it("will not close an approval item through the request path", async () => {
    const store = await makeStore()
    const approval = store.raise(raiseInput("alice"))
    const attentionId = store.open("alice")[0]?.id ?? ""

    expect(store.resolveRequest("alice", attentionId)).toBeUndefined()
    // The approval's own attention item is untouched.
    expect(store.open("alice")).toHaveLength(1)
    expect(store.getApproval("alice", approval.id)?.state).toBe("pending")
  })
})
