import { describe, expect, it } from "vitest"
import { composeSessionKey, parseSessionKey, sessionTenantId } from "../src/identity.ts"

describe("session keys", () => {
  it("round-trips a main chat", () => {
    const key = composeSessionKey({ tenantId: "usr_abc123", agentId: "devops" })
    expect(key).toBe("usr_abc123:devops")
    expect(parseSessionKey(key)).toEqual({ tenantId: "usr_abc123", agentId: "devops" })
  })

  it("round-trips a job session", () => {
    const key = composeSessionKey({ tenantId: "usr_abc123", agentId: "devops", jobId: 42 })
    expect(key).toBe("usr_abc123:devops__job-42")
    expect(parseSessionKey(key)).toEqual({
      tenantId: "usr_abc123",
      agentId: "devops",
      jobId: 42,
    })
  })

  it("round-trips an agent-to-agent thread session", () => {
    const key = composeSessionKey({ tenantId: "usr_abc123", agentId: "code", counterpart: "pm" })
    expect(key).toBe("usr_abc123:code__a2-pm")
    expect(parseSessionKey(key)).toEqual({
      tenantId: "usr_abc123",
      agentId: "code",
      counterpart: "pm",
    })
  })

  it("round-trips a later main chat and a side chat", () => {
    const laterMain = composeSessionKey({
      tenantId: "alice",
      agentId: "pm",
      chat: { kind: "main", id: 7 },
    })
    expect(laterMain).toBe("alice:pm__c7")
    expect(parseSessionKey(laterMain)).toEqual({
      tenantId: "alice",
      agentId: "pm",
      chat: { kind: "main", id: 7 },
    })

    const side = composeSessionKey({
      tenantId: "alice",
      agentId: "pm",
      chat: { kind: "side", id: 3 },
    })
    expect(side).toBe("alice:pm__t3")
    expect(parseSessionKey(side)).toEqual({
      tenantId: "alice",
      agentId: "pm",
      chat: { kind: "side", id: 3 },
    })
  })

  it("rejects a malformed chat suffix", () => {
    expect(parseSessionKey("alice:pm__c0")).toBeUndefined() // ids are positive
    expect(parseSessionKey("alice:pm__cx")).toBeUndefined()
    expect(parseSessionKey("alice:pm__z5")).toBeUndefined() // unknown suffix letter
  })

  it("resolves the tenant and renderer of a thread session", () => {
    // code renders and answers; pm is the counterpart asking.
    const identity = parseSessionKey("alice:code__a2-pm")
    expect(identity).toMatchObject({ tenantId: "alice", agentId: "code", counterpart: "pm" })
  })

  it("rejects a thread suffix with an invalid counterpart", () => {
    expect(parseSessionKey("alice:code__a2-Bad_Name")).toBeUndefined()
    expect(parseSessionKey("alice:code__a2-")).toBeUndefined()
  })

  // The whole point of putting the tenant in the key: a job claimed from the
  // poll loop after a restart arrives as this string and nothing else.
  it("resolves the tenant of a job session with no request in sight", () => {
    expect(sessionTenantId("usr_abc123:devops__job-42")).toBe("usr_abc123")
  })

  it("keeps two tenants' identical agent names apart", () => {
    expect(sessionTenantId("alice:devops")).toBe("alice")
    expect(sessionTenantId("bob:devops")).toBe("bob")
  })

  // A better-auth id is not ours to choose, so parsing must not assume more
  // about it than "no colon".
  it("accepts a tenant id containing underscores and hyphens", () => {
    expect(parseSessionKey("a_b-c__d:devops")).toEqual({ tenantId: "a_b-c__d", agentId: "devops" })
  })

  it("takes the tenant from the first colon only", () => {
    expect(parseSessionKey("tenant:devops:extra")).toBeUndefined()
  })

  describe("rejects", () => {
    const malformed = [
      ["no tenant separator", "devops"],
      ["an empty tenant", ":devops"],
      ["an empty agent", "tenant:"],
      ["an uppercase agent", "tenant:DevOps"],
      ["an underscore in the agent", "tenant:dev_ops"],
      ["a job id that is not a number", "tenant:devops__job-abc"],
      ["an unknown scope suffix", "tenant:devops__chat-1"],
      ["a bare job separator", "tenant:devops__"],
      ["an empty string", ""],
    ] as const

    for (const [why, key] of malformed) {
      it(why, () => {
        expect(parseSessionKey(key)).toBeUndefined()
        expect(sessionTenantId(key)).toBeUndefined()
      })
    }
  })

  it("throws when composing from parts the server should never hold", () => {
    expect(() => composeSessionKey({ tenantId: "a:b", agentId: "devops" })).toThrow()
    expect(() => composeSessionKey({ tenantId: "tenant", agentId: "dev_ops" })).toThrow()
  })
})
