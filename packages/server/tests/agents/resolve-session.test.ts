import { beforeAll, describe, expect, it } from "vitest"
import { resolveAgentSession } from "../../src/agents/resolve-session.ts"
import { ModelCredentialStore } from "../../src/coordinator/model-credentials.ts"
import { RosterStore } from "../../src/coordinator/roster.ts"
import { migratedDatabase } from "../migrated-database.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

/**
 * The tenancy claim, checked directly.
 *
 * The design bet is that a turn can be resolved from the session key **alone**,
 * because Flue claims submissions from a poll loop and a job resumed after a
 * restart has no request, no headers and no async context to read a tenant
 * from. An `AsyncLocalStorage` tenant would be empty exactly there.
 *
 * What actually needs proving is that *our* resolution takes nothing but the
 * key. Flue's part — persisting the key on the submission and handing it back
 * on resume — is Flue's guarantee, and testing it would mean spawning servers
 * and calling real models to re-verify someone else's durability engine.
 *
 * So these cases feed `resolveAgentSession` the exact session keys a resumed
 * job would arrive with, and assert it lands on the right tenant's row. The
 * function signature carries the rest of the argument: it has no ambient input
 * available, so a resumed turn and a live one cannot diverge.
 */
async function stores() {
  const db = await migratedDatabase()
  const roster = new RosterStore(db)
  const credentials = new ModelCredentialStore(db)

  for (const [tenant, word] of [
    ["alice", "ALPHA"],
    ["bob", "BRAVO"],
  ] as const) {
    const credential = credentials.create(tenant, {
      scope: "user",
      kind: "api_key",
      upstream: "anthropic",
      label: `${tenant}-key`,
      apiKey: `sk-ant-${tenant}`,
      isDefault: false,
    })
    // Both tenants own an agent called `devops`. Resolving to "a" member is not
    // enough; it has to be the right one.
    roster.create(tenant, {
      id: "devops",
      name: `${tenant} ops`,
      systemPrompt: word,
      model: "claude-sonnet-5",
      credentialId: credential.id,
      tools: [],
    })
  }
  return { roster, credentials }
}

describe("resolving a turn from its session key", () => {
  it("resolves a main chat", async () => {
    const resolution = resolveAgentSession("alice:devops", await stores())

    expect(resolution.kind).toBe("ready")
    if (resolution.kind !== "ready") return
    expect(resolution.member.systemPrompt).toBe("ALPHA")
  })

  /**
   * The case the whole design exists for. This is the exact string a job
   * resumed from the poll loop arrives with, and it is the only input.
   */
  it("resolves a job session to the tenant named in the key", async () => {
    const resolution = resolveAgentSession("alice:devops__job-7", await stores())

    expect(resolution.kind).toBe("ready")
    if (resolution.kind !== "ready") return
    expect(resolution.member.systemPrompt).toBe("ALPHA")
    expect(resolution.member.tenantId).toBe("alice")
  })

  // Same agent id, same job number, different tenant — the confusion a resumed
  // turn would make if the tenant came from anywhere but the key.
  it("keeps two tenants' identical job sessions apart", async () => {
    const shared = await stores()

    const mine = resolveAgentSession("alice:devops__job-7", shared)
    const theirs = resolveAgentSession("bob:devops__job-7", shared)

    expect(mine.kind === "ready" && mine.member.systemPrompt).toBe("ALPHA")
    expect(theirs.kind === "ready" && theirs.member.systemPrompt).toBe("BRAVO")
  })

  it("pays with the credential belonging to the key's tenant", async () => {
    const shared = await stores()

    const mine = resolveAgentSession("alice:devops__job-7", shared)
    const theirs = resolveAgentSession("bob:devops__job-7", shared)

    expect(mine.kind === "ready" && theirs.kind === "ready").toBe(true)
    if (mine.kind !== "ready" || theirs.kind !== "ready") return
    expect(mine.credentialId).not.toBe(theirs.credentialId)
    // The provider id carries the credential, so the model string differs too —
    // one tenant's turn cannot be billed to another's key.
    expect(mine.model).not.toBe(theirs.model)
  })

  it("resolves the same result for a job session as its main chat", async () => {
    const shared = await stores()

    const main = resolveAgentSession("alice:devops", shared)
    const job = resolveAgentSession("alice:devops__job-7", shared)

    expect(main.kind === "ready" && main.model).toBe(job.kind === "ready" && job.model)
  })

  describe("refuses rather than guessing", () => {
    it("an unparseable key", async () => {
      expect(resolveAgentSession("devops", await stores()).kind).toBe("invalid-session")
    })

    it("a tenant with no such agent", async () => {
      expect(resolveAgentSession("carol:devops__job-7", await stores()).kind).toBe("unknown-member")
    })

    it("an agent whose credential is gone", async () => {
      const shared = await stores()
      const roster = shared.roster as RosterStore
      roster.create("alice", {
        id: "orphan",
        name: "Orphan",
        systemPrompt: "…",
        credentialId: "does-not-exist",
        tools: [],
      })

      const resolution = resolveAgentSession("alice:orphan__job-1", shared)
      expect(resolution.kind).toBe("no-credential")
      if (resolution.kind !== "no-credential") return
      expect(resolution.message).toContain("no longer exists")
    })
  })
})
