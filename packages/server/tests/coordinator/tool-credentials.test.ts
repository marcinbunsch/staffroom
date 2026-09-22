import { beforeAll, describe, expect, it } from "vitest"
import { ToolCredentialStore } from "../../src/coordinator/tool-credentials.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

async function makeStore(): Promise<ToolCredentialStore> {
  return new ToolCredentialStore(await migratedDatabase())
}

// User tokens are scoped like any other row; org secrets are shared (covered
// below). The contract seeds user tokens, one tool per "record".
defineTenantIsolationTests("tool credentials (user)", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, tool) => {
      store.put(tenantId, { scope: "user", tool, secret: `secret-${tool}` })
      return tool
    },
    read: (tenantId, tool) => store.list(tenantId).find((credential) => credential.tool === tool),
    list: (tenantId) => store.list(tenantId).filter((credential) => credential.scope === "user"),
  }
})

describe("tool credentials", () => {
  it("resolves an org secret for anyone", async () => {
    const store = await makeStore()
    store.put(null, { scope: "org", tool: "firecrawl", secret: "fc-shared-key" })
    expect(store.orgSecret("firecrawl")).toBe("fc-shared-key")
  })

  it("resolves a per-user token only for its owner", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "gmail", secret: "alice-gmail" })
    expect(store.userToken("alice", "gmail")).toBe("alice-gmail")
    expect(store.userToken("bob", "gmail")).toBeUndefined()
  })

  it("answers the offer-or-not question for a token", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "gmail", secret: "x" })
    expect(store.hasUserToken("alice", "gmail")).toBe(true)
    expect(store.hasUserToken("bob", "gmail")).toBe(false)
  })

  /** A grant is a per-user access flag with no secret — GCP's shape. */
  it("records a per-user grant with no secret", async () => {
    const store = await makeStore()
    store.put(null, { scope: "grant", tool: "gcp", user: "alice" })

    expect(store.isGranted("alice", "gcp")).toBe(true)
    expect(store.isGranted("bob", "gcp")).toBe(false)
    const granted = store.list("alice").find((c) => c.tool === "gcp")
    expect(granted).toMatchObject({ scope: "grant", hint: "granted" })
  })

  it("keeps at most one org credential per tool, replacing on re-put", async () => {
    const store = await makeStore()
    store.put(null, { scope: "org", tool: "firecrawl", secret: "old" })
    store.put(null, { scope: "org", tool: "firecrawl", secret: "new" })
    expect(store.orgSecret("firecrawl")).toBe("new")
  })

  it("keeps at most one per-user token per (tool, user)", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "gmail", secret: "one" })
    store.put("alice", { scope: "user", tool: "gmail", secret: "two" })
    expect(store.userToken("alice", "gmail")).toBe("two")
    expect(
      store.list("alice").filter((c) => c.tool === "gmail" && c.scope === "user"),
    ).toHaveLength(1)
  })

  it("never returns a secret with the record, only a hint", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "gmail", secret: "sk-alice-gmail-secret" })
    const credential = store.list("alice").find((c) => c.tool === "gmail")
    expect(JSON.stringify(credential)).not.toContain("sk-alice-gmail-secret")
    expect(credential?.hint).toBe("sk-a…cret")
  })

  it("marks a user token stale and clears it again", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "github", secret: "ghp" })
    expect(store.isStale("alice", "github")).toBe(false)

    store.markStale("alice", "github")
    expect(store.isStale("alice", "github")).toBe(true)

    store.clearStale("alice", "github")
    expect(store.isStale("alice", "github")).toBe(false)
  })

  it("keeps staleness scoped to the owner", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "github", secret: "a" })
    store.put("bob", { scope: "user", tool: "github", secret: "b" })
    store.markStale("alice", "github")
    expect(store.isStale("alice", "github")).toBe(true)
    expect(store.isStale("bob", "github")).toBe(false)
  })

  it("clears staleness when the token is reconnected (re-put)", async () => {
    const store = await makeStore()
    store.put("alice", { scope: "user", tool: "github", secret: "old" })
    store.markStale("alice", "github")
    expect(store.isStale("alice", "github")).toBe(true)

    store.put("alice", { scope: "user", tool: "github", secret: "new" })
    expect(store.isStale("alice", "github")).toBe(false)
    expect(store.userToken("alice", "github")).toBe("new")
  })

  it("treats marking a non-existent token as a no-op", async () => {
    const store = await makeStore()
    store.markStale("alice", "github")
    expect(store.isStale("alice", "github")).toBe(false)
  })

  it("shows a tenant the org secrets plus their own tokens and grants", async () => {
    const store = await makeStore()
    store.put(null, { scope: "org", tool: "firecrawl", secret: "shared" })
    store.put("alice", { scope: "user", tool: "gmail", secret: "mine" })
    store.put(null, { scope: "grant", tool: "gcp", user: "alice" })
    store.put("bob", { scope: "user", tool: "gmail", secret: "theirs" })

    const seen = store
      .list("alice")
      .map((c) => `${c.scope}:${c.tool}`)
      .sort()
    expect(seen).toEqual(["grant:gcp", "org:firecrawl", "user:gmail"])
  })
})
