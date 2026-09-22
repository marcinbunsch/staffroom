import { beforeAll, describe, expect, it } from "vitest"
import {
  CredentialInUseError,
  ModelCredentialStore,
  providerIdOf,
} from "../../src/coordinator/model-credentials.ts"
import { RosterStore } from "../../src/coordinator/roster.ts"
import { migratedDatabase } from "../migrated-database.ts"
import { defineTenantIsolationTests } from "../tenant-isolation.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

async function makeStore(): Promise<ModelCredentialStore> {
  return new ModelCredentialStore(await migratedDatabase())
}

function seedKey(store: ModelCredentialStore, tenantId: string | null, label: string) {
  return store.create(tenantId, {
    scope: tenantId === null ? "org" : "user",
    kind: "api_key",
    upstream: "anthropic",
    label,
    apiKey: `sk-ant-${label}-0000`,
    isDefault: false,
  })
}

// A user credential is scoped like any other row. Org credentials are shared
// on purpose and are covered separately below.
defineTenantIsolationTests("model credentials (user scope)", async () => {
  const store = await makeStore()
  return {
    create: (tenantId, label) => seedKey(store, tenantId, label).id,
    read: (tenantId, id) => store.get(tenantId, id),
    list: (tenantId) => store.list(tenantId),
    remove: (tenantId, id) => store.remove(tenantId, id),
  }
})

describe("model credentials", () => {
  it("never returns the secret with the record", async () => {
    const store = await makeStore()
    const credential = seedKey(store, "alice", "personal")

    expect(JSON.stringify(credential)).not.toContain("sk-ant-personal-0000")
    expect(credential.hint).toBe("sk-an…0000")
  })

  it("hands the plaintext only to the caller that asks for it by id", async () => {
    const store = await makeStore()
    const credential = seedKey(store, "alice", "personal")

    expect(store.secretOf(credential.id)?.secret).toBe("sk-ant-personal-0000")
  })

  // The shared-visibility rule, and the reason org credentials are not covered
  // by the isolation contract: everyone is meant to see them.
  it("shows an org credential to every tenant", async () => {
    const store = await makeStore()
    const shared = seedKey(store, null, "company key")

    expect(store.get("alice", shared.id)?.label).toBe("company key")
    expect(store.get("bob", shared.id)?.label).toBe("company key")
    expect(shared.tenantId).toBeNull()
  })

  it("gives each credential its own provider id, and org keys a stable one", async () => {
    const store = await makeStore()
    const mine = seedKey(store, "alice", "mine")
    const theirs = seedKey(store, "bob", "theirs")
    const shared = seedKey(store, null, "shared")

    expect(mine.providerId).not.toBe(theirs.providerId)
    expect(shared.providerId).toBe("anthropic-org")
    expect(providerIdOf(mine)).toBe(mine.providerId)
  })

  it("keeps at most one default", async () => {
    const store = await makeStore()
    store.create(null, {
      scope: "org",
      kind: "api_key",
      upstream: "anthropic",
      label: "first",
      apiKey: "sk-ant-first",
      isDefault: true,
    })
    store.create(null, {
      scope: "org",
      kind: "api_key",
      upstream: "openai",
      label: "second",
      apiKey: "sk-openai-second",
      isDefault: true,
    })

    expect(store.defaultCredential()?.label).toBe("second")
  })

  it("sets any credential as the default, with a fallback model", async () => {
    const store = await makeStore()
    const first = store.create(null, {
      scope: "org",
      kind: "api_key",
      upstream: "anthropic",
      label: "org key",
      apiKey: "sk-ant-first",
      isDefault: true,
    })
    const personal = store.create("alice", {
      scope: "user",
      kind: "codex_oauth",
      label: "My ChatGPT",
      authJson: { tokens: { access_token: "ey.a", refresh_token: "r" } },
      isDefault: false,
    })

    const updated = store.setDefault("alice", personal.id, "gpt-5.6-terra")
    expect(updated?.isDefault).toBe(true)
    expect(updated?.defaultModel).toBe("gpt-5.6-terra")
    // The prior default is cleared — a personal credential can hold it now.
    expect(store.defaultCredential()?.id).toBe(personal.id)
    expect(store.get("alice", first.id)?.isDefault).toBe(false)
  })

  it("stores an imported Codex login without an api key", async () => {
    const store = await makeStore()
    const credential = store.create("alice", {
      scope: "user",
      kind: "codex_oauth",
      label: "My ChatGPT",
      authJson: { tokens: { access_token: "ey.a", refresh_token: "r", account_id: "acct_1" } },
      isDefault: false,
    })

    expect(credential.upstream).toBe("openai-codex")
    expect(credential.hint).toBe("acct_1")
    expect(store.secretOf(credential.id)?.secret).toContain("refresh_token")
  })

  it("stores an optional local-server API key without exposing it", async () => {
    const store = await makeStore()
    const credential = store.create("alice", {
      scope: "user",
      kind: "local",
      upstream: "lm-studio",
      label: "My LM Studio",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "lm-secret-key",
      isDefault: false,
    })

    expect(credential.baseUrl).toBe("http://localhost:1234/v1")
    expect(credential.hint).toBe("http://localhost:1234/v1")
    expect(JSON.stringify(credential)).not.toContain("lm-secret-key")
    expect(store.secretOf(credential.id)?.secret).toBe("lm-secret-key")
  })

  it("keeps a keyless local server usable", async () => {
    const store = await makeStore()
    const credential = store.create("alice", {
      scope: "user",
      kind: "local",
      upstream: "lm-studio",
      label: "My LM Studio",
      baseUrl: "http://localhost:1234/v1",
      isDefault: false,
    })

    expect(store.secretOf(credential.id)?.secret).toBe("")
  })

  it("replaces a secret in place, which is how a refreshed token lands", async () => {
    const store = await makeStore()
    const credential = seedKey(store, "alice", "personal")
    store.replaceSecret(credential.id, "sk-ant-rotated")

    expect(store.secretOf(credential.id)?.secret).toBe("sk-ant-rotated")
  })

  /**
   * Refusing rather than cascading. Nulling the staff column instead would
   * repoint those agents at the org credential — a different bill, chosen by a
   * delete made for an unrelated reason.
   */
  it("refuses to delete a credential an agent still uses", async () => {
    const db = await migratedDatabase()
    const store = new ModelCredentialStore(db)
    const roster = new RosterStore(db)
    const credential = seedKey(store, "alice", "personal")
    roster.create("alice", {
      id: "devops",
      name: "DevOps",
      systemPrompt: "…",
      credentialId: credential.id,
      tools: [],
    })

    expect(() => store.remove("alice", credential.id)).toThrow(CredentialInUseError)
    expect(store.get("alice", credential.id)).toBeTruthy()
  })

  it("deletes a credential nothing uses", async () => {
    const db = await migratedDatabase()
    const store = new ModelCredentialStore(db)
    const credential = seedKey(store, "alice", "personal")

    expect(store.remove("alice", credential.id)).toBe(true)
    expect(store.get("alice", credential.id)).toBeUndefined()
  })
})
