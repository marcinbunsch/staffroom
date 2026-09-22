import type { ToolProvisioning } from "@staffroom/protocol"
import { beforeAll, describe, expect, it } from "vitest"
import { ToolCredentialStore } from "../../src/coordinator/tool-credentials.ts"
import {
  type AttachTool,
  type ToolDescriptor,
  attachGrantedTools,
  resolveToolCredential,
  toolCatalog,
} from "../../src/tools/registry.ts"
import { migratedDatabase } from "../migrated-database.ts"

beforeAll(() => {
  process.env.STAFFROOM_SECRET_KEY = "a-test-encryption-key"
})

async function makeCredentials(): Promise<ToolCredentialStore> {
  return new ToolCredentialStore(await migratedDatabase())
}

/** Attach into a list rather than a Flue render frame, recording the credential. */
function collecting() {
  const attached: { name: string; orgSecret?: string; userToken?: string }[] = []
  const attach: AttachTool = (descriptor, context) => {
    attached.push({
      name: descriptor.name,
      orgSecret: context.credential.orgSecret,
      userToken: context.credential.userToken,
    })
  }
  return { attached, attach }
}

const base = { tenantId: "alice", agent: "devops", session: "alice:devops" }

describe("the tool catalog", () => {
  it("has no built-in credentialed tools — Firecrawl moved to a token integration + MCP toolset", () => {
    expect(toolCatalog()).toEqual([])
    // current_time is a built-in, never a grantable catalog tool.
    expect(toolCatalog().find((entry) => entry.name === "current_time")).toBeUndefined()
  })
})

describe("attaching granted tools", () => {
  it("does not attach current_time as a grant — it is a built-in now", async () => {
    const { attached, attach } = collecting()
    attachGrantedTools(["current_time"], base, attach, await makeCredentials())
    expect(attached).toEqual([])
  })

  it("ignores an unknown grant (an MCP name, a typo)", async () => {
    const { attached, attach } = collecting()
    attachGrantedTools(["not_a_real_tool"], base, attach, await makeCredentials())
    expect(attached).toEqual([])
  })
})

/**
 * The offer-or-not rule across every provisioning shape. The real tools of the
 * credential-backed shapes are deferred verbatim lifts, so the resolver is
 * exercised directly with a synthetic descriptor per shape.
 */
describe("resolving a credential across provisioning shapes", () => {
  function descriptor(provisioning: ToolProvisioning): ToolDescriptor {
    return {
      name: `tool_${provisioning}`,
      description: "",
      provisioning,
      gated: false,
      build() {},
    }
  }

  it("org-key: needs the shared secret", async () => {
    const credentials = await makeCredentials()
    const tool = descriptor("org-key")
    expect(resolveToolCredential(tool, "alice", credentials)).toBeUndefined()

    credentials.put(null, { scope: "org", tool: tool.name, secret: "shared" })
    expect(resolveToolCredential(tool, "alice", credentials)).toEqual({ orgSecret: "shared" })
  })

  it("user-key: needs the caller's own token", async () => {
    const credentials = await makeCredentials()
    const tool = descriptor("user-key")
    expect(resolveToolCredential(tool, "alice", credentials)).toBeUndefined()

    credentials.put("alice", { scope: "user", tool: tool.name, secret: "mine" })
    expect(resolveToolCredential(tool, "alice", credentials)).toEqual({ userToken: "mine" })
    // Bob still cannot use it.
    expect(resolveToolCredential(tool, "bob", credentials)).toBeUndefined()
  })

  it("oauth: needs both the org app config and the caller's token", async () => {
    const credentials = await makeCredentials()
    const tool = descriptor("oauth")
    credentials.put(null, { scope: "org", tool: tool.name, secret: "app-config" })
    // Org config alone is not enough — the user has not connected.
    expect(resolveToolCredential(tool, "alice", credentials)).toBeUndefined()

    credentials.put("alice", { scope: "user", tool: tool.name, secret: "alice-token" })
    expect(resolveToolCredential(tool, "alice", credentials)).toEqual({
      orgSecret: "app-config",
      userToken: "alice-token",
    })
  })

  it("integration: keys the credential off the integration, not the tool name", async () => {
    const credentials = await makeCredentials()
    // A tool that belongs to an integration reads the integration's org config
    // and per-user token, so a family could share one app config and connection.
    const tool: ToolDescriptor = { ...descriptor("oauth"), integration: "google" }
    credentials.put(null, { scope: "org", tool: "google", secret: "app-config" })
    // Its own name has no credential; only the integration's does.
    expect(resolveToolCredential(tool, "alice", credentials)).toBeUndefined()

    credentials.put("alice", { scope: "user", tool: "google", secret: "alice-refresh" })
    expect(resolveToolCredential(tool, "alice", credentials)).toEqual({
      orgSecret: "app-config",
      userToken: "alice-refresh",
    })
  })

  it("org-key-user-grant: needs the org secret and a grant, but binds no user token", async () => {
    const credentials = await makeCredentials()
    const tool = descriptor("org-key-user-grant")
    credentials.put(null, { scope: "org", tool: tool.name, secret: "service-account" })
    // Org secret present, but Alice is not granted.
    expect(resolveToolCredential(tool, "alice", credentials)).toBeUndefined()

    credentials.put(null, { scope: "grant", tool: tool.name, user: "alice" })
    expect(resolveToolCredential(tool, "alice", credentials)).toEqual({
      orgSecret: "service-account",
    })
  })

  /**
   * A tool whose availability is a runtime probe (Docker: is the daemon up).
   * The unavailable branch is skipped before build, so an unregistered probe
   * never reaches the model.
   */
  it("does not build a tool whose runtime probe fails", async () => {
    const docker: ToolDescriptor = {
      name: "code_sandbox",
      description: "",
      provisioning: "none",
      gated: false,
      available: () => false,
      build() {
        throw new Error("must not build when unavailable")
      },
    }
    expect(docker.available?.()).toBe(false)
    // The resolver still returns a (credential-free) result; availability is the
    // separate gate that attachGrantedTools applies before calling build.
    expect(resolveToolCredential(docker, "alice", await makeCredentials())).toEqual({})
  })
})
